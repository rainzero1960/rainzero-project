# knowledgepaper/backend/vectorstore/manager.py
# vectorstore/manager.py
from pathlib import Path
import threading
import yaml
import os
import shutil
import chromadb
from chromadb.config import Settings
import time
from typing import List, Dict, Tuple, Union # Union をインポート

from langchain_chroma import Chroma
from langchain_google_community import BigQueryVectorStore
from langchain_community.vectorstores.utils import DistanceStrategy
from langchain_core.vectorstores import VectorStore # VectorStore をインポート
from routers.module.embeddings import EMBED
from google.cloud import bigquery

_vector_store_instance = None
_lock = threading.Lock()
_cfg = None
_vector_store_init_failed_permanently = False
_init_lock = threading.Lock()

def load_vector_cfg():
    global _cfg
    if _cfg is None:
        with _lock:
            if _cfg is None:
                cfg_path = Path(__file__).parent.parent / "config.yaml"
                full_config = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
                deploy_env = os.getenv("DEPLOY", "cloud")
                if deploy_env == "local":
                    _cfg = full_config.get("local_vector_store", {})
                    _cfg.setdefault("type", "chroma")
                    _cfg.setdefault("tenant_name", chromadb.DEFAULT_TENANT)
                    _cfg.setdefault("database_name", chromadb.DEFAULT_DATABASE)
                    _cfg.setdefault("collection_name", "papers")
                else:
                    _cfg = full_config.get("bq_vector_store", {})
                    if not _cfg.get("type"): _cfg["type"] = "bigquery_vector_search"
                if not _cfg:
                    raise ValueError(f"Vector store config for DEPLOY='{deploy_env}' not found.")
    return _cfg

def _reset_global_instance_state():
    global _vector_store_instance, _vector_store_init_failed_permanently
    _vector_store_instance = None
    _vector_store_init_failed_permanently = False
    print("Global vector store instance and failure flag have been reset.")

def _init_vectordb() -> VectorStore: # 返り値の型を VectorStore に変更
    cfg = load_vector_cfg()
    store_type = cfg.get("type")
    vs: VectorStore # vsの型を VectorStore に変更

    if store_type == "chroma":
        try:
            cfg_dir = Path(__file__).parent.parent
            raw_dir = cfg.get("persist_dir", "./database/vector_db")
            persist_path_str = str((cfg_dir / raw_dir).resolve())

            Path(persist_path_str).mkdir(parents=True, exist_ok=True)

            tenant_name = cfg.get("tenant_name")
            database_name = cfg.get("database_name")
            collection_name = cfg.get("collection_name")

            print(f"Attempting to initialize ChromaDB: persist_path='{persist_path_str}', tenant='{tenant_name}', database='{database_name}', collection='{collection_name}'")
            
            client_settings = Settings(
                is_persistent=True,
                persist_directory=persist_path_str,
            )
            client = chromadb.PersistentClient(
                path=persist_path_str,
                settings=client_settings,
                tenant=tenant_name,
                database=database_name,
            )
            
            vs = Chroma(
                client=client,
                collection_name=collection_name,
                embedding_function=EMBED,
            )
            print(f"ChromaDB initialized. Collection '{collection_name}' should be accessible.")
        except ValueError as e:
            print(f"ERROR initializing ChromaDB (ValueError): {e}. Path: {persist_path_str}")
            raise ConnectionError(f"Value error during ChromaDB init: {e}") from e
        except Exception as e:
            print(f"UNEXPECTED ERROR initializing ChromaDB: {e}. Path: {persist_path_str}")
            raise ConnectionError(f"Unexpected error during ChromaDB init: {e}") from e
        
    elif store_type == "bigquery_vector_search":
        try:
            project_id = os.getenv("BIGQUERY_PROJECT_ID") or cfg.get("project_id")
            dataset_name = os.getenv("BIGQUERY_DATASET_NAME") or cfg.get("dataset_name")
            table_name = os.getenv("BIGQUERY_TABLE_NAME") or cfg.get("table_name")
            location = os.getenv("BIGQUERY_LOCATION") or cfg.get("location")

            if not all([project_id, dataset_name, table_name, location]):
                raise ValueError("BigQuery Vector Store configuration is incomplete.")

            distance_strategy_str = cfg.get("distance_strategy", "COSINE").upper()
            if distance_strategy_str == "COSINE":
                distance_strategy = DistanceStrategy.COSINE
            elif distance_strategy_str == "EUCLIDEAN":
                distance_strategy = DistanceStrategy.EUCLIDEAN
            elif distance_strategy_str == "DOT_PRODUCT":
                distance_strategy = DistanceStrategy.DOT_PRODUCT
            else:
                raise ValueError(f"Unsupported distance_strategy: {distance_strategy_str}")
            
            vs = BigQueryVectorStore(
                project_id=project_id,
                dataset_name=dataset_name,
                table_name=table_name,
                location=location,
                embedding=EMBED,
                distance_strategy=distance_strategy,
            )
            print(f"Initialized BigQuery vector store: {project_id}.{dataset_name}.{table_name}")
        except Exception as e:
            print(f"ERROR initializing BigQueryVectorStore: {e}")
            raise
    else:
        raise ValueError(f"Unsupported vector store type: {store_type}")
    
    if vs is None:
        raise ConnectionError("Vector store instance (vs) was not initialized.")
    return vs

def get_vector_store() -> VectorStore: # 返り値の型を VectorStore に変更
    global _vector_store_instance, _vector_store_init_failed_permanently
    if _vector_store_init_failed_permanently:
        print("Vector store initialization previously failed permanently. Not retrying.")
        raise ConnectionError("Vector store is unavailable due to previous permanent initialization failures.")

    if _vector_store_instance is None:
        with _init_lock:
            if _vector_store_instance is None:
                print("Attempting to initialize vector store instance...")
                try:
                    _vector_store_instance = _init_vectordb()
                    print("Vector store instance initialized successfully in get_vector_store.")
                except Exception as e:
                    _vector_store_instance = None
                    _vector_store_init_failed_permanently = True
                    print(f"CRITICAL: Failed to initialize vector store instance in get_vector_store: {e}")
                    raise ConnectionError(f"Failed to initialize vector store: {e}") from e
    return _vector_store_instance

def reset_vector_store_for_testing():
    global _vector_store_instance, _vector_store_init_failed_permanently, _cfg
    with _init_lock:
        _vector_store_instance = None
        _vector_store_init_failed_permanently = False
        _cfg = None
        print("Vector store instance and config cache have been reset for testing/re-init.")

def add_texts(*, texts, metadatas=None, ids=None, batch_size=100):
    vs = get_vector_store()
    cfg = load_vector_cfg()
    store_type = cfg.get("type")

    print(f"Adding {len(texts)} texts to vector store of type '{store_type}' with IDs: {ids}")
    num_batches = (len(texts) + batch_size - 1) // batch_size

    if store_type == "chroma":
        if not isinstance(vs, Chroma):
             raise TypeError("Vector store is not a Chroma instance for add_texts with ids.")
        #return vs.add_texts(texts=texts, metadatas=metadatas, ids=ids)
        else:
            for i in range(num_batches):
                start_idx = i * batch_size
                end_idx = min((i + 1) * batch_size, len(texts))
                batch_texts = texts[start_idx:end_idx]
                batch_metadatas = metadatas[start_idx:end_idx] if metadatas else None
                batch_ids = ids[start_idx:end_idx] if ids else None

                print(f"Adding batch {i + 1}/{num_batches} with {len(batch_texts)} texts.")
                vs.add_texts(texts=batch_texts, metadatas=batch_metadatas, ids=batch_ids)
            print(f"All {len(texts)} texts added to ChromaDB in {num_batches} batches.")
        return vs
    elif store_type == "bigquery_vector_search":
        if not isinstance(vs, BigQueryVectorStore):
            raise TypeError("Vector store is not a BigQueryVectorStore instance for add_texts.")
        #return vs.add_texts(texts=texts, metadatas=metadatas)
        else:
            for i in range(num_batches):
                start_idx = i * batch_size
                end_idx = min((i + 1) * batch_size, len(texts))
                batch_texts = texts[start_idx:end_idx]
                batch_metadatas = metadatas[start_idx:end_idx] if metadatas else None

                print(f"Adding batch {i + 1}/{num_batches} with {len(batch_texts)} texts.")
                vs.add_texts(texts=batch_texts, metadatas=batch_metadatas)
            print(f"All {len(texts)} texts added to BigQuery in {num_batches} batches.")
        return vs
    else:
        raise ValueError(f"add_texts not implemented for store type: {store_type}")

def search_by_vector(*, embedding, k=5, filter_param=None):
    vs = get_vector_store()
    cfg = load_vector_cfg()
    store_type = cfg.get("type")

    if store_type == "chroma":
        if not isinstance(vs, Chroma):
            raise TypeError("Vector store is not a Chroma instance for similarity_search_by_vector_with_relevance_scores.")
        if filter_param and not isinstance(filter_param, dict):
             print(f"Warning: Chroma filter_param is not a dict: {filter_param}.")
        return vs.similarity_search_by_vector_with_relevance_scores(
            embedding=embedding, k=k, filter=filter_param,
        )
    elif store_type == "bigquery_vector_search":
        if not isinstance(vs, BigQueryVectorStore):
            raise TypeError("Vector store is not a BigQueryVectorStore instance for similarity_search_by_vector_with_score.")
        return vs.similarity_search_by_vector_with_score(
            embedding=embedding, k=k, filter=filter_param
        )
    else:
        raise ValueError(f"search_by_vector not implemented for store type: {store_type}")

def delete_all_vectors():
    cfg = load_vector_cfg()
    store_type = cfg.get("type")
    global _vector_store_instance, _vector_store_init_failed_permanently

    print("Attempting to delete all vectors...")
    cfg_dir = Path(__file__).parent.parent
    raw_dir = cfg.get("persist_dir", "./database/vector_db")
    persist_path = (cfg_dir / raw_dir).resolve()

    if _vector_store_instance and store_type == "chroma":
        try:
            current_cfg_for_delete = load_vector_cfg()
            tenant_to_reset = current_cfg_for_delete.get("tenant_name", chromadb.DEFAULT_TENANT)
            db_to_reset = current_cfg_for_delete.get("database_name", chromadb.DEFAULT_DATABASE)

            maintenance_settings = Settings(
                is_persistent=True,
                persist_directory=str(persist_path),
                allow_reset=True,
            )
            maintenance_client = chromadb.PersistentClient(
                path=str(persist_path),
                settings=maintenance_settings,
                tenant=tenant_to_reset,
                database=db_to_reset,
            )
            maintenance_client.reset()
            print(f"ChromaDB client reset successfully for tenant '{tenant_to_reset}', database '{db_to_reset}'.")
        except Exception as e:
            print(f"Warning: Failed to reset ChromaDB client: {e}. Proceeding with directory deletion.")

    _reset_global_instance_state()

    if store_type == "chroma":
        if persist_path.exists() and persist_path.is_dir():
            print(f"Deleting ChromaDB directory: {persist_path}")
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    shutil.rmtree(persist_path)
                    print(f"Successfully deleted ChromaDB directory: {persist_path}")
                    break
                except OSError as e:
                    print(f"Warning: Attempt {attempt + 1} to delete {persist_path} failed: {e}")
                    if attempt < max_retries - 1:
                        time.sleep(1)
                    else:
                        print(f"ERROR: Failed to delete ChromaDB directory {persist_path} after {max_retries} attempts: {e}.")
                        _vector_store_init_failed_permanently = True
                        raise ConnectionError(f"Failed to delete ChromaDB directory {persist_path}, cannot re-initialize cleanly.") from e
        else:
            print(f"ChromaDB directory not found or not a directory, nothing to delete: {persist_path}")
        print("ChromaDB data directory targeted for deletion. Instance will be re-initialized on next get_vector_store().")

    elif store_type == "bigquery_vector_search":
        project_id = os.getenv("BIGQUERY_PROJECT_ID") or cfg.get("project_id")
        dataset_name = os.getenv("BIGQUERY_DATASET_NAME") or cfg.get("dataset_name")
        table_name = os.getenv("BIGQUERY_TABLE_NAME") or cfg.get("table_name")
        location = os.getenv("BIGQUERY_LOCATION") or cfg.get("location")

        if not all([project_id, dataset_name, table_name, location]):
            print("Warning: BigQuery connection details missing, cannot delete table.")
            return

        from google.cloud import bigquery as bq_client
        from google.api_core.exceptions import NotFound

        client = bq_client.Client(project=project_id, location=location)
        table_id = f"{project_id}.{dataset_name}.{table_name}"
        try:
            client.get_table(table_id)
            client.delete_table(table_id, not_found_ok=True)
            print(f"Deleted BigQuery table {table_id}")
        except NotFound:
            print(f"BigQuery table {table_id} not found, nothing to delete.")
        except Exception as e:
            print(f"Error deleting BigQuery table {table_id}: {e}")
        _vector_store_instance = None
        print("BigQuery table deleted (or not found) and instance reset.")
    else:
        raise ValueError(f"delete_all_vectors not implemented for store type: {store_type}")

def delete_vectors_by_metadata(metadata_filter: dict):
    cfg = load_vector_cfg()
    store_type = cfg.get("type")
    vs = get_vector_store()

    if store_type == "chroma":
        if not isinstance(vs, Chroma):
            raise TypeError("Vector store is not a Chroma instance for delete with where.")

        try:
            print(f"Attempting to delete from ChromaDB with original filter: {metadata_filter}")
            
            if not metadata_filter:
                print("Metadata filter is empty. No vectors will be deleted from ChromaDB.")
                return

            chroma_filter_conditions = []
            for key, value in metadata_filter.items():
                chroma_filter_conditions.append({key: value})
            
            if not chroma_filter_conditions: #ありえないはずだが念のため
                print("No conditions derived from metadata_filter. Skipping delete.")
                return

            if len(chroma_filter_conditions) == 1:
                # 条件が1つの場合は、$and は不要
                chroma_where_clause = chroma_filter_conditions[0]
            else:
                # 条件が複数の場合は、$and で結合
                chroma_where_clause = {"$and": chroma_filter_conditions}
                
            print(f"Formatted ChromaDB where clause for delete: {chroma_where_clause}")
            vs.delete(where=chroma_where_clause) # 修正されたフィルタを使用
            # deleteメソッドは通常、削除されたIDのリストなどを返すが、ここでは件数などは返さない
            print(f"ChromaDB delete call executed for filter: {metadata_filter}")

        except Exception as e:
            # エラーメッセージに元のフィルタと整形後のフィルタ両方を含めるとデバッグしやすい
            print(f"Error deleting vectors from ChromaDB. Original filter: {metadata_filter}, Formatted where: {chroma_where_clause if 'chroma_where_clause' in locals() else 'N/A'}. Error: {e}")
    elif store_type == "bigquery_vector_search":
        table_id = cfg.get("table_name")
        if not table_id:
            raise ValueError(
                "`table_name` が vector 設定に未定義です。yaml に追加してください。"
            )


        project_id = os.getenv("BIGQUERY_PROJECT_ID") or cfg.get("project_id")
        location = os.getenv("BIGQUERY_LOCATION") or cfg.get("location")

        #client = bigquery.Client()
        client = bigquery.Client(project=project_id, location=location)

        if table_id.count(".") == 0:
            default_dataset = cfg.get("dataset_name") or os.getenv("BIGQUERY_DATASET")
            if not default_dataset:
                raise ValueError(
                    "dataset_name に dataset が含まれていないかつ dataset_id が設定されていません。"
                )
            table_id = f"{default_dataset}.{table_id}"

        if table_id.count(".") == 1:
            table_id = f"{client.project}.{table_id}"

        try:
            client = bigquery.Client(project=project_id, location=location)
            #client = bigquery.Client()

            cond_parts = []
            params = []
            for idx, (key, val) in enumerate(metadata_filter.items()):
                pname = f"p{idx}"
                cond_parts.append(f"`{key}` = @{pname}")
                # metadata_filter の値は文字列として渡されると想定し、
                # BigQueryの列の型に合わせてパラメータの型もSTRINGとする
                param_value = str(val) # 念のため文字列に変換
                param_type = "STRING"
                params.append(bigquery.ScalarQueryParameter(pname, param_type, param_value))

            if not cond_parts:
                raise ValueError("metadata_filter が空のため、削除条件がありません。")

            where_clause = " AND ".join(cond_parts)
            query = f"DELETE FROM `{table_id}` WHERE {where_clause}"
            job_cfg = bigquery.QueryJobConfig(query_parameters=params)
            job = client.query(query, job_config=job_cfg)
            job.result()

            print(
                    f"BigQuery delete executed: {job.num_dml_affected_rows} rows "
                    f"removed for filter {metadata_filter}"
                )
        except Exception as e:
            print(
                f"Error deleting vectors from BigQuery with filter {metadata_filter}: {e}"
            )

def batch_check_vector_existence(user_id: str, paper_metadata_ids: List[str]) -> Dict[str, bool]:
    """
    指定されたユーザーと論文IDリストに対して、ベクトルの存在を一括チェックする。
    
    Args:
        user_id (str): ユーザーID
        paper_metadata_ids (List[str]): 論文メタデータIDのリスト
        
    Returns:
        Dict[str, bool]: {paper_metadata_id: bool} の形式で存在状況を返す
    """
    vs = get_vector_store()
    cfg = load_vector_cfg()
    store_type = cfg.get("type")
    
    result = {}
    
    if not paper_metadata_ids:
        return result
    
    if store_type == "chroma":
        if not isinstance(vs, Chroma):
            raise TypeError("Vector store is not a Chroma instance for batch_check_vector_existence.")
        
        try:
            # ChromaDBでは、user_idと各paper_metadata_idの組み合わせで一括検索
            for paper_metadata_id in paper_metadata_ids:
                metadata_filter = {
                    "user_id": user_id,
                    "paper_metadata_id": paper_metadata_id
                }
                
                chroma_filter_conditions = []
                for key, value in metadata_filter.items():
                    chroma_filter_conditions.append({key: value})
                
                if len(chroma_filter_conditions) == 1:
                    chroma_where_clause = chroma_filter_conditions[0]
                else:
                    chroma_where_clause = {"$and": chroma_filter_conditions}
                
                results = vs.get(where=chroma_where_clause, include=["metadatas"])
                result[paper_metadata_id] = len(results.get('ids', [])) > 0
                
        except Exception as e:
            print(f"Error in batch check vector existence in ChromaDB: {e}")
            # エラー時はすべてFalseで初期化
            for paper_metadata_id in paper_metadata_ids:
                result[paper_metadata_id] = False
    
    elif store_type == "bigquery_vector_search":
        if not isinstance(vs, BigQueryVectorStore):
            raise TypeError("Vector store is not a BigQueryVectorStore instance for batch_check_vector_existence.")
        
        try:
            from google.cloud import bigquery
            
            bq_client = vs._bq_client
            vector_table_full_id = vs.full_table_id
            
            # 一括クエリを作成: UNNEST句を使用して安全にパラメータ化
            query_str = f"""
                SELECT paper_metadata_id, COUNT(*) as count
                FROM `{vector_table_full_id}`
                WHERE user_id = @user_id AND paper_metadata_id IN UNNEST(@paper_ids)
                GROUP BY paper_metadata_id
            """
            
            job_config = bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
                bigquery.ArrayQueryParameter("paper_ids", "STRING", paper_metadata_ids),
            ])
            
            query_job = bq_client.query(query_str, job_config=job_config)
            results = list(query_job)
            
            # 結果をマップに変換
            existing_papers = set()
            for row in results:
                if row.count > 0:
                    existing_papers.add(row.paper_metadata_id)
            
            # 全ての論文IDに対して結果を設定
            for paper_metadata_id in paper_metadata_ids:
                result[paper_metadata_id] = paper_metadata_id in existing_papers
                
        except Exception as e:
            print(f"Error in batch check vector existence in BigQuery: {e}")
            # エラー時はすべてFalseで初期化
            for paper_metadata_id in paper_metadata_ids:
                result[paper_metadata_id] = False
    
    else:
        raise ValueError(f"batch_check_vector_existence not implemented for store type: {store_type}")
    
    return result


def vector_exists_for_user_paper(user_id: str, paper_metadata_id: str) -> bool:
    """
    指定されたユーザーと論文の組み合わせでベクトルが既に存在するかを確認する。
    
    Args:
        user_id (str): ユーザーID
        paper_metadata_id (str): 論文メタデータID
        
    Returns:
        bool: ベクトルが存在する場合True、存在しない場合False
    """
    vs = get_vector_store()
    cfg = load_vector_cfg()
    store_type = cfg.get("type")
    
    if store_type == "chroma":
        if not isinstance(vs, Chroma):
            raise TypeError("Vector store is not a Chroma instance for vector_exists_for_user_paper.")
        
        try:
            # ChromaDBでは、user_idとpaper_metadata_idの組み合わせで検索
            metadata_filter = {
                "user_id": user_id,
                "paper_metadata_id": paper_metadata_id
            }
            
            # フィルタ条件を設定してget操作を実行
            chroma_filter_conditions = []
            for key, value in metadata_filter.items():
                chroma_filter_conditions.append({key: value})
            
            if len(chroma_filter_conditions) == 1:
                chroma_where_clause = chroma_filter_conditions[0]
            else:
                chroma_where_clause = {"$and": chroma_filter_conditions}
            
            results = vs.get(where=chroma_where_clause, include=["metadatas"])
            
            # 結果があれば存在する
            return len(results.get('ids', [])) > 0
            
        except Exception as e:
            print(f"Error checking vector existence in ChromaDB: {e}")
            return False
    
    elif store_type == "bigquery_vector_search":
        if not isinstance(vs, BigQueryVectorStore):
            raise TypeError("Vector store is not a BigQueryVectorStore instance for vector_exists_for_user_paper.")
        
        try:
            from google.cloud import bigquery
            
            bq_client = vs._bq_client
            vector_table_full_id = vs.full_table_id
            
            query_str = f"""
                SELECT COUNT(*) as count
                FROM `{vector_table_full_id}`
                WHERE user_id = @user_id AND paper_metadata_id = @paper_metadata_id
            """
            
            job_config = bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("user_id", "STRING", user_id),
                bigquery.ScalarQueryParameter("paper_metadata_id", "STRING", paper_metadata_id),
            ])
            
            query_job = bq_client.query(query_str, job_config=job_config)
            results = list(query_job)
            
            # カウントが0より大きければ存在する
            return results[0].count > 0 if results else False
            
        except Exception as e:
            print(f"Error checking vector existence in BigQuery: {e}")
            return False
    
    else:
        raise ValueError(f"vector_exists_for_user_paper not implemented for store type: {store_type}")


def get_embeddings_by_metadata_filter(
    metadata_conditions_list: List[Dict[str, str]]
) -> List[Tuple[Dict[str, str], List[float]]]:
    """
    指定されたメタデータ条件のリストに合致するドキュメントのベクトルを取得する。
    各条件辞書はANDで結合され、リスト内の各条件辞書はORで結合されるイメージ。
    返り値は、(合致したメタデータ条件, 対応するベクトル) のタプルのリスト。
    """
    vs = get_vector_store()
    cfg = load_vector_cfg()
    store_type = cfg.get("type")
    
    all_results: List[Tuple[Dict[str, str], List[float]]] = []

    if not metadata_conditions_list:
        return []

    if store_type == "chroma":
        if not isinstance(vs, Chroma):
            raise TypeError("Vector store is not a Chroma instance for get_embeddings_by_metadata_filter.")
        
        ids_to_fetch = []
        metadata_map_by_id = {}
        for cond_dict in metadata_conditions_list:
            uid = cond_dict.get("user_id")
            
            # 新しい1論文1ベクトル設計: user_id + paper_metadata_id で識別
            paper_meta_id = cond_dict.get("paper_metadata_id")
            if uid and paper_meta_id:
                chroma_id = f"user_{uid}_paper_{paper_meta_id}" 
                ids_to_fetch.append(chroma_id)
                metadata_map_by_id[chroma_id] = cond_dict
            
            # 旧設計との互換性維持: generated_summary_id での検索も対応
            sid = cond_dict.get("generated_summary_id")
            if uid and sid and not paper_meta_id:
                chroma_id = f"user_{uid}_summary_{sid}_0" 
                ids_to_fetch.append(chroma_id)
                metadata_map_by_id[chroma_id] = cond_dict
        
        if ids_to_fetch:
            try:
                results = vs.get(ids=ids_to_fetch, include=["embeddings"])
                if results and len(results.get('ids', [])) > 0 and len(results.get('embeddings', [])) > 0:
                    for i, res_id in enumerate(results['ids']):
                        original_cond = metadata_map_by_id.get(res_id)
                        embedding = results['embeddings'][i]
                        if original_cond is not None and embedding is not None:
                            all_results.append((original_cond, embedding))
            except Exception as e:
                print(f"Error fetching embeddings from ChromaDB by IDs: {e}")

    elif store_type == "bigquery_vector_search":
        if not isinstance(vs, BigQueryVectorStore):
            raise TypeError("Vector store is not a BigQueryVectorStore instance for get_embeddings_by_metadata_filter.")

        bq_client = vs._bq_client
        vector_table_full_id = vs.full_table_id
        embedding_column_name = vs.embedding_field
        user_id_col = "user_id" 

        or_conditions_sql = []
        select_fields = [user_id_col, embedding_column_name]
        
        for cond_dict in metadata_conditions_list:
            uid = cond_dict.get("user_id")
            
            # 新しい1論文1ベクトル設計: user_id + paper_metadata_id で検索
            paper_meta_id = cond_dict.get("paper_metadata_id")
            if uid and paper_meta_id:
                paper_meta_col = "paper_metadata_id"
                if paper_meta_col not in select_fields:
                    select_fields.append(paper_meta_col)
                # paper_metadata_idも文字列として扱う（BigQueryスキーマ対応）
                or_conditions_sql.append(f"({user_id_col} = '{uid}' AND {paper_meta_col} = '{paper_meta_id}')")
            
            # 旧設計との互換性維持: generated_summary_id での検索も対応
            elif uid and cond_dict.get("generated_summary_id"):
                sid = cond_dict.get("generated_summary_id")
                summary_id_col = "generated_summary_id"
                if summary_id_col not in select_fields:
                    select_fields.append(summary_id_col)
                # generated_summary_idも文字列として扱う（BigQueryスキーマ対応）
                or_conditions_sql.append(f"({user_id_col} = '{uid}' AND {summary_id_col} = '{sid}')")
        
        if or_conditions_sql:
            from google.cloud import bigquery
            query_str = f"""
                SELECT {', '.join(select_fields)}
                FROM `{vector_table_full_id}`
                WHERE {' OR '.join(or_conditions_sql)}
            """
            try:
                print(f"Executing BigQuery get_embeddings_by_metadata_filter query: {query_str}")
                query_job = bq_client.query(query_str)
                row_count = 0
                for row in query_job:
                    row_count += 1
                    retrieved_uid = row[user_id_col]
                    embedding_vector = list(row[embedding_column_name])
                    
                    print(f"[DEBUG] Processing row: user_id={retrieved_uid}, paper_metadata_id={row.get('paper_metadata_id')}, embedding_length={len(embedding_vector)}")
                    
                    # 新しい設計と旧設計の両方に対応したマッチング
                    original_cond_found = None
                    for oc in metadata_conditions_list:
                        print(f"[DEBUG] Checking condition: {oc}")
                        if oc.get("user_id") == retrieved_uid:
                            print(f"[DEBUG] User ID matched: {retrieved_uid}")
                            print(f"[DEBUG] Row keys: {list(row.keys())}")
                            print(f"[DEBUG] oc.get('paper_metadata_id'): {oc.get('paper_metadata_id')}")
                            print(f"[DEBUG] 'paper_metadata_id' in row: {'paper_metadata_id' in row}")
                            
                            # 新しい設計: paper_metadata_id でマッチング（BigQuery Row対応）
                            if oc.get("paper_metadata_id") and "paper_metadata_id" in row.keys():
                                retrieved_paper_meta_id = row["paper_metadata_id"]
                                print(f"[DEBUG] Comparing paper_metadata_id: '{oc.get('paper_metadata_id')}' vs '{retrieved_paper_meta_id}'")
                                if str(oc.get("paper_metadata_id")) == str(retrieved_paper_meta_id):
                                    print(f"[DEBUG] Paper metadata ID matched!")
                                    original_cond_found = oc
                                    break
                                else:
                                    print(f"[DEBUG] Paper metadata ID did not match")
                            # 旧設計: generated_summary_id でマッチング（BigQuery Row対応）
                            elif oc.get("generated_summary_id") and "generated_summary_id" in row.keys():
                                retrieved_sid = row["generated_summary_id"]
                                print(f"[DEBUG] Comparing generated_summary_id: '{oc.get('generated_summary_id')}' vs '{retrieved_sid}'")
                                if str(oc.get("generated_summary_id")) == str(retrieved_sid):
                                    print(f"[DEBUG] Generated summary ID matched!")
                                    original_cond_found = oc
                                    break
                                else:
                                    print(f"[DEBUG] Generated summary ID did not match")
                            else:
                                print(f"[DEBUG] Neither paper_metadata_id nor generated_summary_id condition met")
                    
                    if original_cond_found:
                        print(f"[DEBUG] Adding result for condition: {original_cond_found}")
                        all_results.append((original_cond_found, embedding_vector))
                    else:
                        print(f"[DEBUG] No matching condition found for this row")
                
                print(f"[DEBUG] BigQuery returned {row_count} rows for metadata filter query")
                
                # デバッグ: 結果が0件の場合、テーブルのサンプルデータを確認
                if row_count == 0:
                    debug_query = f"""
                        SELECT user_id, paper_metadata_id, COUNT(*) as count
                        FROM `{vector_table_full_id}`
                        WHERE user_id = '{metadata_conditions_list[0].get("user_id")}'
                        GROUP BY user_id, paper_metadata_id
                        LIMIT 10
                    """
                    print(f"[DEBUG] Checking table contents: {debug_query}")
                    debug_job = bq_client.query(debug_query)
                    debug_rows = list(debug_job)
                    print(f"[DEBUG] Sample table data for user: {debug_rows}")
                    
            except Exception as e:
                print(f"Error fetching embeddings from BigQuery by metadata filter: {e}")
    else:
        raise ValueError(f"get_embeddings_by_metadata_filter not implemented for store type: {store_type}")
        
    return all_results