#!/usr/bin/env python3
"""Actual HTTP acceptance gate for a separately launched read-only synthetic copy."""
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

ORIGIN="http://127.0.0.1:3000"


def run():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    checks=[]
    def request(path,method="GET",expected=200):
        req=urllib.request.Request(ORIGIN+path,data=None if method=="GET" else b"{}",method=method,
            headers={"Origin":ORIGIN,"Content-Type":"application/json"})
        try: response=opener.open(req,timeout=20)
        except urllib.error.HTTPError as exc:response=exc
        body=json.loads(response.read())
        assert response.code==expected,(path,method,response.code,body)
        return response,body
    response,context=request("/api/demo/context")
    assert context["dataset_kind"]=="synthetic" and context["revision"]=="r111" and context["write_policy"]=="read_only"
    assert response.headers["x-registry-write-policy"]=="read_only"
    assert context["personas"]==[] and context["research"]["available"] is False
    checks.append({"name":"server descriptor and headers identify read-only synthetic copy with no persona/research mutations","passed":True})
    _,listing=request("/api/horses?limit=5")
    checks.append({"name":"public registry GET remains available","passed":True})
    _,auth=request("/api/auth/me")
    assert auth["user"] is None
    _,ai=request("/api/ai/status")
    assert ai["available"] is False
    checks.append({"name":"normal sign-in and conversation research remain unavailable","passed":True})
    for path in ["/api/auth/demo-admin","/api/demo/clock","/api/demo/run-pending-jobs","/api/billing/orders","/api/horses","/api/ai/conversations"]:
        _,body=request(path,"POST",403)
        assert body["error"]=="reference_read_only"
        checks.append({"name":"server denies POST "+path,"passed":True})
    for method in ["PUT","PATCH","DELETE"]:
        _,body=request("/api/horses/900000017",method,403)
        assert body["error"]=="reference_read_only"
        checks.append({"name":"server denies "+method+" horse mutation","passed":True})
    return {"suite":"r111-real-loopback-readonly","origin":ORIGIN,"dataset":"synthetic:r111","checked_at":datetime.now(timezone.utc).isoformat(),"passed":len(checks),"checks":checks}


if __name__=="__main__":
    try:print(json.dumps(run(),indent=2))
    except Exception as exc:
        print(json.dumps({"failure":str(exc)},indent=2))
        sys.exit(1)
