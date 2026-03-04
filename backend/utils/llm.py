"""
LLM utility functions shared across the entire backend.

Provides a factory for creating LLM instances and helper functions
for streaming and non-streaming invocation patterns.
"""
from langchain_openai import ChatOpenAI

from ..config.settings import get_settings

# Hard limits to prevent indefinite hangs if the API is slow or unresponsive.
_SILENT_TIMEOUT = 60   # seconds for non-streaming (analysis) calls
_STREAM_TIMEOUT = 120  # seconds for streaming generation calls


def create_llm(temperature: float = 0, streaming: bool = False) -> ChatOpenAI:
    """
    Create a ChatOpenAI instance using application settings.
    Supports any OpenAI-compatible API (OpenAI, Zhipu GLM, DeepSeek, etc.)
    by configuring OPENAI_API_BASE in .env.

    @param temperature: Sampling temperature for generation
    @param streaming: Whether this instance will be used for streaming
    @returns: Configured ChatOpenAI instance
    """
    settings = get_settings()
    timeout = _STREAM_TIMEOUT if streaming else _SILENT_TIMEOUT
    kwargs: dict = {
        "model": settings.openai_model,
        "temperature": temperature,
        "request_timeout": timeout,
    }
    if settings.openai_api_key:
        kwargs["api_key"] = settings.openai_api_key
    if settings.openai_api_base:
        kwargs["base_url"] = settings.openai_api_base

    return ChatOpenAI(**kwargs)


def strip_code_fence(text: str) -> str:
    """
    Remove markdown code fences from an LLM response.

    @param text: Raw LLM response text
    @returns: Text with leading/trailing code fences removed
    """
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return text


def call_llm_silent(messages: list, temperature: float = 0) -> str:
    """
    Invoke the LLM without streaming (for internal analysis calls).
    Times out after 60 seconds.

    @param messages: Chat messages to send
    @param temperature: Sampling temperature
    @returns: Full response text
    """
    llm = create_llm(temperature=temperature, streaming=False)
    response = llm.invoke(messages)
    return response.content.strip()


def stream_llm(messages: list, on_token, temperature: float = 0) -> str:
    """
    Stream LLM tokens, calling on_token for each non-empty chunk.
    Times out after 120 seconds.

    @param messages: Chat messages to send to the LLM
    @param on_token: Callable(token: str) invoked for each streamed token
    @param temperature: Sampling temperature
    @returns: Full collected response text
    """
    llm = create_llm(temperature=temperature, streaming=True)
    full_text = ""
    for chunk in llm.stream(messages):
        token = chunk.content if hasattr(chunk, "content") else str(chunk)
        if token:
            on_token(token)
            full_text += token
    return full_text
