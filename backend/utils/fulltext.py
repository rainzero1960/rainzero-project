import re, tempfile, requests, html2text
from bs4 import BeautifulSoup
from PyPDF2 import PdfReader
import arxiv
import asyncio
import httpx

ARXIV_ID_RE = re.compile(r"https?://arxiv\.org/abs/(?P<id>\d{4}\.\d{5}(v\d+)?)")

def extract_text_from_html(arxiv_id: str) -> str | None:
    url = f"https://arxiv.org/html/{arxiv_id}"
    r = requests.get(url, timeout=20, allow_redirects=True)
    if r.status_code != 200:
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    # arXiv HTML の本文は <div class="ltx_page_content"> 内にある
    body = soup.select_one("div.ltx_page_content")
    if not body:
        return None

    # LaTeX 数式が混ざるため html2text でテキスト化
    md = html2text.html2text(str(body))
    return md.strip()

def extract_text_from_pdf(arxiv_id: str) -> str:
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
    r = requests.get(pdf_url, timeout=30, allow_redirects=True)
    r.raise_for_status()

    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        tmp.write(r.content)
        tmp.flush()
        reader = PdfReader(tmp.name)
        pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()

def _extract_arxiv_id(abs_url: str) -> str | None:
    """
    arXiv URLからarXiv IDを抽出する
    """
    m = ARXIV_ID_RE.match(abs_url.strip())
    if not m:
        return None
    return m.group("id")

def get_arxiv_fulltext(abs_url: str) -> tuple[str, str]:
    """
    戻り値: (arxiv_id, full_text)
    """
    arxiv_id = _extract_arxiv_id(abs_url)
    if not arxiv_id:
        raise ValueError("Invalid arXiv abs URL")

    text = extract_text_from_html(arxiv_id)
    if text:
        return arxiv_id, text

    # HTML が無い場合は PDF へフォールバック
    return arxiv_id, extract_text_from_pdf(arxiv_id)

async def extract_text_from_html_async(arxiv_id: str) -> str | None:
    """非同期版のHTML テキスト抽出"""
    url = f"https://arxiv.org/html/{arxiv_id}"
    
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        try:
            r = await client.get(url)
            if r.status_code != 200:
                return None

            soup = BeautifulSoup(r.text, "html.parser")
            # arXiv HTML の本文は <div class="ltx_page_content"> 内にある
            body = soup.select_one("div.ltx_page_content")
            if not body:
                return None

            # LaTeX 数式が混ざるため html2text でテキスト化
            md = html2text.html2text(str(body))
            return md.strip()
        except Exception:
            return None

async def extract_text_from_pdf_async(arxiv_id: str) -> str:
    """非同期版のPDF テキスト抽出"""
    pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
    
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        r = await client.get(pdf_url)
        r.raise_for_status()

        with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
            tmp.write(r.content)
            tmp.flush()
            reader = PdfReader(tmp.name)
            pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages).strip()

async def get_arxiv_metadata_with_fulltext_async(abs_url: str) -> dict[str, str]:
    """
    非同期版：arXiv URLから論文の詳細情報を取得する
    戻り値: {"title": str, "authors": str, "published_date": str, "abstract": str, "full_text": str}
    """
    arxiv_id = _extract_arxiv_id(abs_url)
    if not arxiv_id:
        raise ValueError("Invalid arXiv abs URL")

    # arXiv APIから論文メタデータを取得（同期部分はrun_in_executorで非同期化）
    loop = asyncio.get_event_loop()
    
    def get_arxiv_metadata():
        search = arxiv.Search(id_list=[arxiv_id])
        result = next(arxiv.Client().results(search))
        return result
    
    try:
        result = await loop.run_in_executor(None, get_arxiv_metadata)
    except StopIteration:
        raise ValueError(f"arXiv ID {arxiv_id} not found on arXiv.")
    
    # フルテキストを非同期で取得
    text = await extract_text_from_html_async(arxiv_id)
    if not text:
        # HTML が無い場合は PDF へフォールバック
        text = await extract_text_from_pdf_async(arxiv_id)

    return {
        "title": result.title,
        "authors": ", ".join(a.name for a in result.authors),
        "published_date": result.published.date().isoformat() if result.published else None,
        "abstract": result.summary.strip(),
        "full_text": text
    }

def get_arxiv_metadata_with_fulltext(abs_url: str) -> dict[str, str]:
    """
    arXiv URLから論文の詳細情報を取得する（同期版：既存コードとの互換性維持）
    戻り値: {"title": str, "authors": str, "published_date": str, "abstract": str, "full_text": str}
    """
    arxiv_id = _extract_arxiv_id(abs_url)
    if not arxiv_id:
        raise ValueError("Invalid arXiv abs URL")

    # arXiv APIから論文メタデータを取得
    try:
        search = arxiv.Search(id_list=[arxiv_id])
        result = next(arxiv.Client().results(search))
    except StopIteration:
        raise ValueError(f"arXiv ID {arxiv_id} not found on arXiv.")
    
    # フルテキストを取得
    text = extract_text_from_html(arxiv_id)
    if not text:
        # HTML が無い場合は PDF へフォールバック
        text = extract_text_from_pdf(arxiv_id)

    return {
        "title": result.title,
        "authors": ", ".join(a.name for a in result.authors),
        "published_date": result.published.date().isoformat() if result.published else None,
        "abstract": result.summary.strip(),
        "full_text": text
    }
