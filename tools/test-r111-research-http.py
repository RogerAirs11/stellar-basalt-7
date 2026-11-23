#!/usr/bin/env python3
"""Actual loopback SSE and stored-evidence checks for the isolated local demo."""
import json
import runpy
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

Client = runpy.run_path(str(Path(__file__).with_name("test-r111-demo-http.py")))["Client"]


def run():
    client, stranger = Client(), Client()
    context = client.request("/api/demo/context")
    assert context["dataset_kind"] == "synthetic" and context["revision"] == "r111" and context["research"]["available"]
    status = client.request("/api/ai/status")
    assert status["available"] and not status["visionAvailable"] and status["defaultModel"] == "offline-sandbox"
    assert [row["provider"] for row in status["models"] if row["available"]] == ["offline"]
    conversation = client.request("/api/ai/conversations", {"mode":"auto","locale":"en","provider":"offline","model":"offline-sandbox"}, expected=201)["conversation"]
    path = "/api/ai/conversations/"+conversation["id"]
    checks = [{"name":"only bounded offline provider advertised; external models and vision unavailable","passed":True}]
    client.login("owner_a")
    # A conversation belongs to its actual auth/anonymous identity, not a global
    # demo actor. Keep this test's persisted conversation under the current user.
    client.request(path, expected=404)
    conversation = client.request("/api/ai/conversations", {"mode":"auto","locale":"en","provider":"offline","model":"offline-sandbox"}, expected=201)["conversation"]
    path = "/api/ai/conversations/"+conversation["id"]
    stranger.request(path, expected=404)
    checks.append({"name":"login changes authority; other session cannot read conversation","passed":True})
    prompts = ["Count horses", "Find DEMO", "Horse 900000017", "Horse 899999999", "Find ABSENTR111NOHORSE", "تعداد اسب‌ها", "Predict the best foal"]
    final_messages = []
    for prompt in prompts:
        body = {"clientMessageId":str(uuid.uuid4()),"text":prompt,"pageContext":{"route":"/database","horseId":900000017}}
        stream = client.request(path+"/messages", body).decode()
        events = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith("data: ")]
        assert not any(event["type"] == "error" for event in events), events
        done = [event["message"] for event in events if event["type"] == "done"]
        assert len(done) == 1
        message = done[0]
        assert message["provider"] == "offline"
        evidence = message.get("evidence", [])
        entities = message.get("entityRefs", [])
        if prompt in ("Count horses", "تعداد اسب‌ها"):
            assert "**"+str(context["counts"]["horses"])+"**" in message["text"]
            assert any(row["sourceRef"] == "analytics:count:{}" for row in evidence)
        elif prompt == "Horse 900000017":
            assert any(row["kind"] == "horse" and row["id"] == "900000017" and row["href"] == "/horse/900000017" for row in entities)
            assert any(row["sourceRef"] == "horse:900000017" for row in evidence)
        elif prompt == "Find DEMO":
            assert len([row for row in entities if row["kind"] == "horse"]) > 0
            assert "bounded result slice" in message["text"]
            for row in entities:
                if row["kind"] == "horse":
                    client.request("/api/horses/"+row["id"])
        elif prompt == "Horse 899999999":
            assert "No public horse profile" in message["text"] and not evidence and not entities
        elif prompt == "Find ABSENTR111NOHORSE":
            assert "No matching records" in message["text"] and not entities
        else:
            assert "unavailable" in message["text"] and not evidence and not entities
        assert all(row["id"] in message["text"] for row in evidence)
        checks.append({"name":"SSE and actual evidence: "+prompt,"passed":True})
        final_messages.append(message)
        replay = client.request(path+"/messages", body).decode()
        replay_events = [json.loads(line[6:]) for line in replay.splitlines() if line.startswith("data: ")]
        assert len(replay_events) == 1 and replay_events[0]["type"] == "done" and replay_events[0]["message"]["id"] == message["id"]
    saved = client.request(path)["conversation"]["messages"]
    assert len([row for row in saved if row["role"] == "assistant"]) == len(prompts)
    assert [row["evidence"] for row in saved if row["role"] == "assistant"] == [row["evidence"] for row in final_messages]
    checks.append({"name":"all responses persisted with real citations and no duplicate on same-message retry","passed":True})
    return {"suite":"r111-real-loopback-research","origin":"http://127.0.0.1:3000","dataset":"synthetic:r111","checked_at":datetime.now(timezone.utc).isoformat(),"passed":len(checks),"checks":checks,"notes":["HTTP used actual Worker handlers, migrated SQLite, session and anonymous authority, SSE orchestration and canonical read-only tools.","Companion Vitest real-database test stubs fetch to throw and proves no external provider IO."]}


if __name__ == "__main__":
    try:
        print(json.dumps(run(),ensure_ascii=False,indent=2))
    except Exception as exc:
        print(json.dumps({"failure":str(exc)},ensure_ascii=False,indent=2))
        sys.exit(1)
