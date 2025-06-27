
from typing import Any, List

from pydantic import SkipValidation
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever

class VectorSearchRetriever(BaseRetriever):
    """
    ベクトル検索を行うためのRetrieverクラス。
    """
    vector_store: SkipValidation[Any]
    embedding_model: SkipValidation[Any]
    k: int = 5  # 返すドキュメント数

    class Config:
        arbitrary_types_allowed = True

    def _get_relevant_documents(self, query: str) -> List[Document]:
        # Dense embedding
        embedding = self.embedding_model.embed_query(query)
        search_results = self.vector_store.similarity_search_by_vector_with_relevance_scores(
            embedding=embedding,
            k=self.k,
        )
        # Document のリストだけ取り出す
        return [doc for doc, _ in search_results]

    async def _aget_relevant_documents(self, query: str) -> List[Document]:
        return self._get_relevant_documents(query)

    def as_tool(self, name: str, description: str):
        """BaseRetriever の as_tool をそのまま利用"""
        return super().as_tool(name=name, description=description)
