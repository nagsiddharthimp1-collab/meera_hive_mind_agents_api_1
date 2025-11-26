from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, Dict

from main import run_meera, init_workflow, workflow as global_workflow

app = FastAPI(title="Meera Hive Mind API")


class ChatRequest(BaseModel):
    user_id: str
    user_message: str


class ChatResponse(BaseModel):
    response: str
    intent: str | None = None
    memory_ids: list[str] | None = None
    raw: Dict[str, Any] | None = None


@app.on_event("startup")
def startup_event():
    init_workflow()


@app.on_event("shutdown")
def shutdown_event():
    if global_workflow is not None:
        global_workflow.close()


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    result = run_meera(req.user_id, req.user_message)

    return ChatResponse(
        response=result.get("response", ""),
        intent=result.get("intent"),
        memory_ids=result.get("memory_ids"),
        raw=result,
    )


@app.get("/health")
def health():
    return {"status": "ok"}
