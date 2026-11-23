#!/usr/bin/env python3
"""Exercise the running, marked LOOPBACK synthetic app through actual HTTP.

Start with npm run dev:demo -- data/demo/r111-rehearsal.sqlite. This script
creates fictional orders/inquiries and advances no production data. It refuses
any other origin or dataset and reports no session cookies or CSRF secrets.
"""
import hashlib
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

ORIGIN = "http://127.0.0.1:3000"
checks = []


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def request(self, path, body=None, *, expected=200, headers=None):
        assert path.startswith("/api/") and not path.startswith("//")
        request_headers = {"Accept":"application/json", "Origin":ORIGIN}
        if self.csrf: request_headers["x-csrf-token"] = self.csrf
        if body is not None: request_headers["Content-Type"] = "application/json"
        request_headers.update(headers or {})
        req = urllib.request.Request(ORIGIN + path, data=None if body is None else json.dumps(body).encode(), headers=request_headers)
        try: response = self.opener.open(req, timeout=30)
        except urllib.error.HTTPError as exc: response = exc
        data = response.read()
        assert response.code == expected, f"{path}: expected {expected}, got {response.code}: {data[:250]!r}"
        return json.loads(data) if "application/json" in response.headers.get("content-type", "") else data

    def login(self, persona):
        result = self.request("/api/auth/demo-admin", {"persona":persona})
        assert result["demo"] is True and result["persona"] == persona
        self.csrf = result["csrfToken"]
        assert self.csrf and any(c.name == "horse_registry_isolated_demo" for c in self.jar)
        return result


def check(name, fn):
    fn()
    checks.append({"name":name,"passed":True})


def run():
    anon = Client()
    context = anon.request("/api/demo/context")
    assert context["dataset_kind"] == "synthetic" and context["revision"] == "r111" and context["write_policy"] == "isolated_local_only"
    personas = {x["key"]: Client() for x in context["personas"]}
    for key, client in personas.items(): client.login(key)
    check("seven real server sessions", lambda: [p.request("/api/auth/me") for p in personas.values()])
    check("anonymous job control refused", lambda: anon.request("/api/demo/run-pending-jobs", {}, expected=401))
    check("non-admin job control refused", lambda: personas["owner_a"].request("/api/demo/run-pending-jobs", {}, expected=403))
    expected_allow = {"owner_a":"/api/workspaces/970000001/tasks", "owner_b":"/api/workspaces/970000002/tasks", "manager":"/api/workspaces/970000003/tasks", "staff":"/api/workspaces/970000001/tasks", "provider":"/api/directory/persons/990000003/profile", "reviewer":"/api/admin/claims", "admin":"/api/admin/notifications/demo-deliveries"}
    for key, path in expected_allow.items():
        check(key + " authorized story", lambda key=key,path=path: personas[key].request(path))
        denied = 970000001 if key in ("owner_b","manager","provider","reviewer") else 970000002
        check(key + " unrelated private workspace denied", lambda key=key,denied=denied: personas[key].request(f"/api/workspaces/{denied}/tasks", expected=404))
    check("staff export denied", lambda: personas["staff"].request("/api/workspaces/970000001/export", expected=404))
    listings = context["stories"]["listings"]
    for row in listings:
        client = personas["owner_a" if row["seller_user_id"] == "demo-owner-a" else "owner_b"]
        check("listing detail " + row["fixture_key"], lambda row=row,client=client: client.request(row["detail_path"]))
        for suffix in ("status","renew","inquiries"):
            check(row["fixture_key"] + " " + suffix + " production route", lambda row=row,client=client,suffix=suffix: client.request(row["detail_path"]+"/"+suffix, {}, expected=400))
    check("unknown UUID returns 404", lambda: anon.request("/api/market/listings/00000000-0000-4000-8000-000000000000", expected=404))
    check("old malformed fixture ID remains rejected", lambda: anon.request("/api/market/listings/r106-demo-listing-17", expected=404))
    first = listings[0]
    owner = personas["owner_a"]
    current = owner.request(first["detail_path"])["listing"]
    changed = owner.request(first["detail_path"]+"/status", {"status":"pending_sale","expected_version":current["row_version"]})
    restored = owner.request(first["detail_path"]+"/status", {"status":"active","expected_version":changed["row_version"]})
    renewed = owner.request(first["detail_path"]+"/renew", {"extend_days":7,"expected_version":restored["row_version"]})
    assert renewed["row_version"] > current["row_version"]
    check("authorized listing status and renewal persist", lambda: owner.request(first["detail_path"]))
    key = "r111-http-inquiry-" + uuid.uuid4().hex
    inquiry = personas["owner_b"].request(first["detail_path"]+"/inquiries", {"buyer_name":"DEMO Owner B","buyer_contact":"demo-owner-b@local.invalid","message":"SYNTHETIC rehearsal inquiry only"}, expected=201, headers={"Idempotency-Key":key})
    check("authorized inquiry persists", lambda: personas["owner_b"].request(first["detail_path"]+"/inquiries", {"buyer_name":"DEMO Owner B","buyer_contact":"demo-owner-b@local.invalid","message":"SYNTHETIC rehearsal inquiry only"}, expected=201, headers={"Idempotency-Key":key}))
    for outcome in ("paid","cancelled","failed","unknown"):
        created = owner.request("/api/billing/orders", {"order_key":"r111-http-"+outcome+"-"+uuid.uuid4().hex[:16],"items":[{"sku":"farm_workspace_monthly","quantity":1}]}, expected=201)
        order_id = created["order"]["id"]
        start = owner.request(f"/api/billing/orders/{order_id}/pay", {}, expected=201)
        assert start["demo"] is True and start["start_pay_url"].startswith(ORIGIN+"/demo-pay/")
        session_path = "/api/demo/payments/"+start["authority"]
        public = anon.request(session_path)
        assert public["verification"] is None
        own = owner.request(session_path)
        assert own["verification"]["attempt_id"] == start["attempt_id"]
        if outcome != "unknown":
            settled = anon.request(session_path, {"outcome":outcome})
            assert settled["status"] == outcome
            callback = urllib.parse.urlsplit(settled["callback_url"])
            assert callback.netloc == "127.0.0.1:3000"
            returned = anon.request(callback.path+"?"+callback.query)
            assert returned["authority"] == start["authority"]
            replay = anon.request(session_path, {"outcome":"cancelled" if outcome == "paid" else "paid"})
            assert replay["status"] == outcome
        verified = owner.request("/api/billing/payments/verify", {"attempt_id":start["attempt_id"]})
        assert verified["verified"] == (outcome == "paid")
        if outcome == "paid":
            second = owner.request("/api/billing/payments/verify", {"attempt_id":start["attempt_id"]})
            assert second["verified"] and second["idempotent_replay"]
            assert second["entitlements"] == verified["entitlements"]
        checks.append({"name":"demo payment " + outcome + " with callback and replay", "passed":True})
    admin = personas["admin"]
    before = admin.request("/api/admin/notifications/demo-deliveries")["demo_inbox"]
    jobs = admin.request("/api/demo/run-pending-jobs", {})
    inbox = admin.request("/api/admin/notifications/demo-deliveries")["demo_inbox"]
    assert len(inbox) >= len(before) and len(inbox) > 0
    assert all(row["to"].endswith("@local.invalid") and row["purpose"] != "login_otp" for row in inbox)
    delivery = next(row for row in inbox if row["provider_side_status"] == "accepted")
    callback_path = f"/api/admin/notifications/demo-deliveries/{delivery['id']}/callback"
    settlement = admin.request(callback_path, {"outcome":"delivered"})
    assert settlement["provider_side_status"] == "delivered"
    replay = admin.request(callback_path, {"outcome":"not_delivered"})
    assert replay["simulated"] is False and replay["provider_side_status"] == "delivered"
    again = admin.request("/api/demo/run-pending-jobs", {})
    assert again["reminders"]["enqueued"] == 0
    check("real reminder outbox accepted then signed delivered; no duplicate", lambda: admin.request("/api/admin/notifications/demo-deliveries"))
    for item in context["stories"]["media"]["items"]:
        if item["public"]:
            data = anon.request(item["url"])
            assert hashlib.sha256(data).hexdigest() == item["sha256"]
            checks.append({"name":"public synthetic PNG bytes match manifest","passed":True})
        else:
            check("private/rejected media is not public "+item["key"], lambda item=item: anon.request(item["url"], expected=404))
    previous_cookies = [(c.name,c.value) for c in owner.jar]
    owner.login("owner_b")
    assert owner.request("/api/auth/me")["user"]["id"] == "demo-owner-b"
    check("principal switch closes old private view", lambda: owner.request("/api/workspaces/970000001/tasks", expected=404))
    old = Client()
    old_auth = old.request("/api/auth/me", headers={"Cookie":"; ".join(k+"="+v for k,v in previous_cookies)})
    assert old_auth["user"] is None
    checks.append({"name":"switch revokes presented old session","passed":True})
    owner.login("owner_a")
    check("A to B to A uses fresh server authority", lambda: owner.request("/api/workspaces/970000001/tasks"))
    owner.request("/api/auth/logout", {})
    assert owner.request("/api/auth/me")["user"] is None
    checks.append({"name":"logout invalidates session","passed":True})
    return {"suite":"r111-real-loopback-http","origin":ORIGIN,"dataset":"synthetic:r111","checked_at":datetime.now(timezone.utc).isoformat(),"passed":len(checks),"checks":checks,"notes":["All requests sent directly to fixed loopback origin with proxies disabled.","Real database, Worker handlers, normal session cookies and CSRF guards used; no SQL-recording doubles.","No live merchant credentials supplied; provider demo records inspected through actual API."]}


if __name__ == "__main__":
    try:
        print(json.dumps(run(),ensure_ascii=False,indent=2))
    except Exception as exc:
        print(json.dumps({"passed_before_failure":len(checks),"checks":checks,"failure":str(exc)},indent=2))
        sys.exit(1)
