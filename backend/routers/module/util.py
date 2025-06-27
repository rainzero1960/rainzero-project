import re
import requests
from bs4 import BeautifulSoup
from datetime import date, timedelta
import concurrent.futures
import arxiv
import os
import io
import PyPDF2   # PDF抽出用に追加
from dotenv import load_dotenv, find_dotenv

# ==============================
# ↓ ここからLangChain周りの import
# ==============================
#from dotenv import load_dotenv
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

_ = load_dotenv(find_dotenv())

#############################################################################
# LangChain設定
##############################################################################
CONFIG = {
    # RAG推論用 LLM の設定
    #"llm_name": "OpenAI_Base",        # "Azure", "Google", "HuggingFace", "OpenAI_Base", "xAI"など
    #"llm_model_name": "gpt-4o",  # 実際に利用するモデルやデプロイ名
    #"llm_model_name": "gpt-4o-mini",  # 実際に利用するモデルやデプロイ名
    #"llm_model_name": "o1",
    #"llm_name": "xAI",        # "Azure", "Google", "HuggingFace", "OpenAI_Base", "xAI"など
    #"llm_model_name": "grok-3-beta",  # 実際に利用するモデルやデプロイ名
    #"llm_name": "VertexAI",
    #"llm_model_name": "gemini-2.0-flash-001",  # 実際に利用するモデルやデプロイ名
    #"llm_model_name": "claude-3-5-sonnet-v2@20241022",  # 実際に利用するモデルやデプロイ名
    "llm_name" : "Google",
    "llm_model_name" : "gemini-2.0-flash",
    "rag_llm_temperature": 0.001,
    "rag_llm_top_p": 0.001,
    "rag_llm_max_output_tokens": 10000,     # VertexAIの設定例など（OpenAIの場合はmax_tokensに相当）
    "llm_max_retries": 5,  # LLM のリトライ回数
    "mode": "hugging_face",  # or "arxiv_list"
    #"mode": "arxiv_list",  # or "hugging_face"
    "arxiv_list_file": "inputs/arxiv_list.txt",  # リストファイルパスを指定
    # Hugging Face 取得日時の設定
    "huggingface_use_config_date": False, 
    #"huggingface_use_config_date": False, 
    "huggingface_custom_date": "2025-03-04",  # ここを任意の日付に
    "article_list_file": "inputs/article_list.txt",  # ← こちらでWeb記事URLリストファイルを指定
}


# --- 追加: カテゴリ別タグ辞書 & フラットリスト ----------------------
TAG_CATEGORIES = {
    # 既存カテゴリ 7 + 追加カテゴリ 6 ＝ 計 13
    "モダリティ／タスク": [
        "Text-Generation","Text-Understanding","Question-Answering","Code-Generation","Prompt","Text-Other",
        "Image-Generation","Image-Classification","Object-Detection","Image-Segmentation","Image-Other",
        "Semantic-Segmentation","Pose-Estimation",
        "Video-Generation","Video-Understanding","Flame-Interpolation","Video-Other",
        "3D-Generation","Speech-Synthesis","Speech-Recognition","Speech-Translation",
        "Audio-Generation","Audio-Classification","Music-Generation","Audio-Understanding","Audio-Other",
        "Multimodal","Reinforcement-Learning","Robotics",
        "Time-Series-Forecasting","Recommendation","Search-Ranking",
        "Anomaly-Detection","Graph-Generation","Others-tasks"
    ],
    "モデルアーキテクチャ": [
        "LLM","Transformer","Diffusion","GAN","VAE","CNN","RNN",
        "Mamba","MoE","Retrieval-Augmented","GNN","Graph-Neural-Network",
        "Foundation-Model","Edge-Model","State-Space-Model","Neural-ODE","DiffEq-Model",
        "Neural-Architecture-Search","Spiking-Neural-Network","Other-Model","No-Model",
    ],
    "技術トピック": [
        "Pre-training","Self-Supervised-Learning","Continual-Learning","Meta-Learning",
        "Fine-tuning","Transfer-Learning","Domain-Adaptation",
        "RLHF","SFT","Chain-of-Thought","Knowledge-Distillation",
        "Quantization","Pruning","Sparsification","LoRA","Adapter","PEFT",
        "Model-Compression","Parallel-Training","Mixed-Precision",
        "Inference-Optimization","Attention-Optimization","Memory-Efficiency",
        "Zero-Shot","Few-Shot","Retrieval","Prompt-Engineering",
        "Reinforcement-Learning","Reward-Model",
        "Federated-Learning","Neural-Architecture-Search","Other-Techniques"
    ],
    "安全性": [
        "Alignment","Hallucination","Bias","Fairness","Privacy-Preserving","Data-Leakage",
        "Copyright","Safety-Kill-Switch","Regulatory-Compliance","Risk-Assessment",
        "Robustness","Watermarking","Explainability","Responsible-AI","Other-Safety"
    ],
    "応用領域": [
        "Healthcare","Legal","Finance","Education","Research-Tools","Creative-Arts",
        "E-Commerce","Gaming","IoT","Autonomous-Driving","AR/VR",
        "Manufacturing","Agriculture","Energy","Security","Smart-City"
    ],
    "インフラ": [
        "GPU","TPU","FPGA","ASIC","Neural-Accelerator","Edge-Device",
        "Distributed-Training","FlashAttention","CUDA","Triton","ONNX","TensorRT",
        "WebGPU","WASM","Serverless","Kubernetes","Ray","vLLM"
    ],
    "データセット／評価": [
        "CommonCrawl","C4","LAION","COCO","ImageNet","LibriSpeech","WMT","OpenWebText",
        "HumanEval","MMLU","GLUE","BIG-bench",
        "Synthetic-Data","Labeled-Data","Unsupervised-Data","Annotation-Method",
        "Benchmark","Robustness-Benchmark","Safety-Benchmark","XAI-Benchmark",
        "The-Pile","RedPajama","MassiveText","Multilingual-Eval","Dataset"
    ],

    # 追加カテゴリ ① AI理論／学習アルゴリズム
    "AI理論／学習アルゴリズム": [
        "Optimization-Theory","Generalization-Theory","Information-Bottleneck",
        "Neural-Scaling-Law","Lottery-Ticket"
    ],

    # 追加カテゴリ ② MLOps／運用
    "MLOps／運用": [
        "Experiment-Tracking","Model-Registry","Continuous-Training",
        "A/B-Testing","CI/CD","Monitoring"
    ],

    # 追加カテゴリ ③ Human–AI Interaction
    "Human–AI Interaction": [
        "Interpretability","Human-in-the-Loop","UI/UX","Trust","Co-Creation"
    ],

    # 追加カテゴリ ④ ロバストネス／セキュリティ
    "ロバストネス／セキュリティ": [
        "Adversarial-Attack","Adversarial-Defense","Poisoning",
        "Backdoor","Watermarking","Robust-Training"
    ],

    # 追加カテゴリ ⑤ データエンジニアリング／品質
    "データエンジニアリング／品質": [
        "Data-Curation","Data-Cleaning","Synthetic-Data-Generation",
        "Active-Learning","Curriculum-Learning"
    ],

    # 追加カテゴリ ⑥ エネルギー効率／サステナビリティ
    "エネルギー効率／サステナビリティ": [
        "Green-AI","Energy-Efficient-Training","Carbon-Footprint","Hardware-Efficiency"
    ],
}


CANDIDATE_TAGS = [t for lst in TAG_CATEGORIES.values() for t in lst]

# --- 追加: LangChain 構造化出力モデル ------------------------------
class TagOutputModel(BaseModel):
    reasoning: str = Field(..., description="選定理由の詳細")
    conclusion: str = Field(..., description="タグ文字列（半角カンマ区切り）")

def extract_model_name(full_model_name: str) -> str:
    """
    'Provider::ModelName' の形式なら 'ModelName' を返す。
    'ModelName' 単体ならそのまま返す。
    """
    if "::" in full_model_name:
        _, model_name = full_model_name.split("::", 1)
        return model_name
    return full_model_name

def initialize_llm(name: str, model_name: str, temperature: float, top_p: float = None, cache_dir: str = None, llm_max_retries: int = 3):
    """
    指定されたパラメータを用いて LLM を初期化する関数。
    """
    llm = None

    model_name = extract_model_name(model_name)  # モデル名を抽出

    if name == "Azure":
        api_key = os.getenv("AZURE_OPENAI_API_KEY")
        api_version = os.getenv("OPENAI_API_VERSION") # AzureではAPIバージョンも必要
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        from langchain_openai import AzureChatOpenAI
        llm = AzureChatOpenAI(
            azure_deployment=model_name,
            temperature=temperature,
            top_p=top_p if top_p else 1.0,
            api_key=api_key,
            api_version=api_version,
            azure_endpoint=azure_endpoint,
            
        )

    elif name == "Google":
        api_key = os.getenv("GOOGLE_API_KEY")
        from langchain_google_genai import ChatGoogleGenerativeAI
        llm = ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=api_key,
            temperature=temperature,
            top_p=top_p if top_p else 1.0,
            max_retries=llm_max_retries,
            model_kwargs={
                "frequency_penalty": 0.3
            }
        )

    elif name == "VertexAI":
        import google.auth
        credentials, project = google.auth.default()
        print(f"Using Google Cloud project: {project}")
        print(f"model_name: {model_name}, temperature: {temperature}, top_p: {top_p}")
        if "gemini" in model_name:
            from langchain_google_vertexai import ChatVertexAI
            llm = ChatVertexAI(
                model_name=model_name,
                temperature=temperature,
                project=project,
                top_p=top_p if top_p else 1.0,
                frequency_penalty=0.3
            )
        elif "claude" in model_name:
            from langchain_google_vertexai.model_garden import ChatAnthropicVertex
            llm = ChatAnthropicVertex(
                project=project,
                location="us-east5",
                model_name=model_name,
                temperature=temperature,
                top_p=top_p if top_p else 1.0
            )
        elif "llama" in model_name:
            from langchain_google_vertexai.model_garden_maas import VertexModelGardenLlama
            llm = VertexModelGardenLlama(
                project=project,
                location="us-central1",
                model_name=model_name,
                temperature=temperature,
                top_p=top_p if top_p else 1.0
            )
        else:
            raise ValueError("VertexAI で不正なモデル名が指定されました。")

    elif name == "HuggingFace":
        from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
        from langchain_huggingface import ChatHuggingFace, HuggingFacePipeline
        do_sample = (temperature > 0.001)
        effective_temp = temperature if do_sample else None
        huggingface_model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype="auto",
            device_map="auto",
            cache_dir=cache_dir,
            force_download=False,
            trust_remote_code=True
        )
        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            cache_dir=cache_dir,
            force_download=False,
            trust_remote_code=True,
            use_fast=True
        )
        gen_pipeline = pipeline(
            "text-generation",
            model=huggingface_model,
            tokenizer=tokenizer,
            temperature=effective_temp,
            do_sample=do_sample,

        )
        pipe = HuggingFacePipeline(pipeline=gen_pipeline)
        llm = ChatHuggingFace(llm=pipe, tokenizer=pipe.pipeline.tokenizer)

    elif name == "OpenAI_Base":
        api_key = os.getenv("OPENAI_API_KEY", "")
        api_endpoint = "https://api.openai.com/v1"
        if "deepseek" in model_name:
            api_key = os.getenv("DEEPSEEK_API_KEY", "")
            api_endpoint = "https://api.deepseek.com"

        if api_key == "":
            raise ValueError("OpenAI API Key が設定されていません。")

        from langchain_openai import ChatOpenAI

        llm=None
        if ("o1" in model_name or "o3" in model_name or "o4" in model_name):
             llm = ChatOpenAI(
                model=model_name,
                openai_api_key=api_key,
                openai_api_base=api_endpoint,
            )
             
        else:
            llm = ChatOpenAI(
                model=model_name,
                openai_api_key=api_key,
                openai_api_base=api_endpoint,
                temperature=temperature,
                top_p=top_p if top_p else 1.0
            )

    elif name == "xAI":
        os.environ["XAI_API_KEY"] = os.getenv("XAI_API_KEY", "")
        from langchain_xai import ChatXAI
        llm = ChatXAI(
            model=model_name,
            temperature=temperature,
            top_p=top_p if top_p else 1.0,
            timeout=None,
            max_retries=llm_max_retries,
        )

    elif name == "MistralAI":
        from langchain_mistralai import ChatMistralAI
        api_key = os.getenv("MISTRAL_API_KEY")
        if not api_key:
            raise ValueError("環境変数 'MISTRAL_API_KEY' が設定されていません。")
        llm = ChatMistralAI(
            model=model_name,
            mistral_api_key=api_key, # 環境変数 MISTRAL_API_KEY があれば自動で読まれる
            temperature=temperature,
            top_p=top_p,
        )

    elif name == "OpenRouter":

        API_KEY = os.getenv("OPENROUTER_API_KEY", "")
        ENDPOINT = "https://openrouter.ai/api/v1"
        #print(f"API_KEY: {API_KEY}")
        llm = None
        if ("r1" in model_name) or ("deepseek" in model_name):
            from langchain_deepseek import ChatDeepSeek

            print("using DeepSeek-r1 by OpenRouter")
            llm = ChatDeepSeek(
                model = model_name, 
                api_base=ENDPOINT, 
                api_key=API_KEY,
                temperature=temperature,
                top_p=top_p,
                ) 

        else:
            from langchain_openai import ChatOpenAI
            llm = ChatOpenAI(
                model=model_name,
                openai_api_key=API_KEY,
                openai_api_base=ENDPOINT,
                max_tokens=None,
                temperature=temperature,
                top_p=top_p,
                #model_kwargs=model_kwargs,
            )

    

    
    else:
        print(f"{name}, {model_name}, {temperature}, {top_p}")
        raise ValueError("サポートされていない LLM 名が指定されました。")

    return llm

##############################################################################
# エスケープ処理: { と } をすべて {{ と }} に
##############################################################################
def escape_curly_braces(text: str) -> str:
    """
    テキスト中の { と } をすべて {{ と }} にエスケープする。
    LangChainのPromptTemplateで波括弧が変数として解釈されるのを防ぐ。
    """
    return text.replace("{", "{{").replace("}", "}}")

if __name__ == "__main__":
   
    # LLMの初期化例
    #llm = initialize_llm("VertexAI", "claude-3-5-haiku@20241022", 0.5)
    #print(f"{llm.invoke('あなたの名前は？')}")
    #print(f"Initialized LLM: {llm}")
    llm = initialize_llm("VertexAI", "meta/llama-3.3-70b-instruct-maas", 0.5)
    print(f"{llm.invoke('あなたの名前は？')}")
    print(f"Initialized LLM: {llm}")