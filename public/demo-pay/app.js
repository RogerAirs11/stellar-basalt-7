/* Demo payment gateway page logic — Horse Registry (R98-N10).
 * Reads the authority from the query, shows the non-sensitive session facts
 * from GET /api/demo/payments/{authority}, settles the session through
 * POST /api/demo/payments/{authority}, then lets the actual order buyer verify
 * the stored payment through the normal billing endpoint. CSP-clean: external
 * file, no inline script, no eval, same-origin fetches only. */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var lang = params.get("lang") === "fa" ? "fa" : "en";
  var authority = (params.get("authority") || "").trim();
  var verification = null;

  var STRINGS = {
    en: {
      banner: "Demonstration gateway — simulated settlement, no real money moves",
      title: "Demo payment",
      subtitle: "This page imitates a payment provider's hosted checkout. No card, bank or personal data is collected.",
      amount: "Amount",
      toman: "toman",
      desc: "Description",
      status: "Session status",
      expiry: "Completable until",
      pay: "Simulate successful payment",
      cancel: "Simulate cancellation",
      fail: "Simulate provider failure",
      failedTitle: "Simulated provider failure recorded",
      failedNote: "The fictional provider declined the payment. No real provider was contacted and no entitlement was granted.",
      fineprint: "Choosing an outcome records a simulated provider fact. The application's server verifies the stored amount and authority before granting any demonstration entitlement.",
      paidTitle: "Demo settlement recorded",
      paidNote: "The simulated provider recorded payment. Verify it below to grant the demo entitlement through the application's server checks.",
      cancelledTitle: "Demo cancellation recorded",
      cancelledNote: "The order remains unpaid. Return to the application to inspect the recorded cancellation.",
      verify: "Verify simulated payment",
      verified: "Server verification succeeded. The demonstration entitlement is active; no real money moved.",
      verifyUnknown: "Verification did not finish. No success is assumed; you can retry this same verification safely.",
      buyerRequired: "Return to the application and sign in as the order's buyer to verify this payment.",
      errorTitle: "Demo session unavailable",
      errorNote: "This demo payment session does not exist, has expired, or the demonstration gateway is not enabled.",
      refLabel: "Provider reference",
      working: "Recording…",
      loadFail: "The demo session could not be loaded."
    },
    fa: {
      banner: "درگاه نمایشی — تسویه شبیه‌سازی‌شده، هیچ پول واقعی جابه‌جا نمی‌شود",
      title: "پرداخت نمایشی",
      subtitle: "این صفحه، صفحه پرداخت ارائه‌دهنده پرداخت را شبیه‌سازی می‌کند. هیچ اطلاعات کارت، بانکی یا شخصی ثبت نمی‌شود.",
      amount: "مبلغ",
      toman: "تومان",
      desc: "شرح",
      status: "وضعیت نشست",
      expiry: "قابل تسویه تا",
      pay: "شبیه‌سازی پرداخت موفق",
      cancel: "شبیه‌سازی انصراف",
      fail: "شبیه‌سازی خطای درگاه",
      failedTitle: "خطای نمایشی درگاه ثبت شد",
      failedNote: "درگاه نمایشی پرداخت را رد کرد. با هیچ درگاه واقعی تماس گرفته نشد و دسترسی جدیدی اعطا نشد.",
      fineprint: "انتخاب نتیجه، یک رویداد نمایشی درگاه را ثبت می‌کند. سرور پیش از اعطای دسترسی، مبلغ و شناسه ثبت‌شده را تأیید می‌کند.",
      paidTitle: "تسویه نمایشی ثبت شد",
      paidNote: "درگاه نمایشی پرداخت را ثبت کرد. برای فعال‌شدن دسترسی نمایشی، آن را در سرور تأیید کنید.",
      cancelledTitle: "انصراف نمایشی ثبت شد",
      cancelledNote: "سفارش پرداخت‌نشده باقی می‌ماند. برای مشاهده انصراف ثبت‌شده به برنامه بازگردید.",
      verify: "تأیید پرداخت نمایشی",
      verified: "تأیید سرور موفق بود. دسترسی نمایشی فعال شد؛ هیچ پول واقعی منتقل نشد.",
      verifyUnknown: "تأیید کامل نشد. موفقیت فرض نمی‌شود؛ می‌توانید همین تأیید را دوباره انجام دهید.",
      buyerRequired: "برای تأیید پرداخت، به برنامه بازگردید و با حساب خریدار سفارش وارد شوید.",
      errorTitle: "نشست نمایشی در دسترس نیست",
      errorNote: "این نشست پرداخت نمایشی وجود ندارد، منقضی شده یا درگاه نمایشی فعال نیست.",
      refLabel: "مرجع ارائه‌دهنده",
      working: "در حال ثبت…",
      loadFail: "بارگذاری نشست نمایشی ممکن نشد."
    }
  };
  var t = STRINGS[lang];

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    setText("banner-text", t.banner);
    setText("title", t.title);
    setText("subtitle", t.subtitle);
    setText("lbl-amount", t.amount);
    setText("unit-toman", t.toman);
    setText("lbl-desc", t.desc);
    setText("lbl-status", t.status);
    setText("lbl-expiry", t.expiry);
    setText("fineprint", t.fineprint);
    var pay = document.getElementById("btn-pay");
    var cancel = document.getElementById("btn-cancel");
    if (pay) pay.textContent = t.pay;
    if (cancel) cancel.textContent = t.cancel;
    setText("btn-fail", t.fail);
    setText("btn-verify", t.verify);
    document.title = lang === "fa" ? "درگاه پرداخت نمایشی — مرکز ثبت اسب" : "Demo Payment Gateway — Horse Registry";
  }

  function showCard(id) {
    ["session-card", "result-card", "error-card"].forEach(function (cardId) {
      var el = document.getElementById(cardId);
      if (el) el.hidden = cardId !== id;
    });
  }

  function formatAmounts(minor) {
    var toman = Math.floor(Number(minor) / 10);
    setText("amount-toman", toman.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"));
    setText("amount-rial", Number(minor).toLocaleString("en-US") + " IRR");
  }

  function formatExpiry(iso) {
    try {
      var d = new Date(iso);
      setText("expires-at", d.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"));
    } catch (e) {
      setText("expires-at", iso);
    }
  }

  function statusPill(status) {
    var pill = document.getElementById("session-status");
    if (!pill) return;
    pill.textContent = status;
    pill.className = "status-pill " + String(status).toLowerCase();
  }

  function prepareVerification() {
    var button = document.getElementById("btn-verify");
    if (verification && verification.state === "verified") {
      setText("verification-status", t.verified);
      if (button) button.hidden = true;
    } else if (verification && Number.isSafeInteger(verification.attempt_id)) {
      if (button) button.hidden = false;
    } else setText("verification-status", t.buyerRequired);
  }

  function verify() {
    var button = document.getElementById("btn-verify");
    if (!verification || !button) return;
    button.disabled = true;
    setText("verification-status", t.working);
    fetch("/api/auth/me", {credentials:"same-origin",headers:{accept:"application/json"}})
      .then(function(response) { if (!response.ok) throw new Error("session"); return response.json(); })
      .then(function(session) {
        if (!session.user || !session.csrfToken) throw new Error("session");
        return fetch("/api/billing/payments/verify", {method:"POST",credentials:"same-origin",
          headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},
          body:JSON.stringify({attempt_id:verification.attempt_id})});
      }).then(function(response) { if (!response.ok) throw new Error("verification"); return response.json(); })
      .then(function(result) {
        if (!result.verified) throw new Error("unverified");
        verification.state = "verified";
        setText("verification-status", t.verified);
        button.hidden = true;
      }).catch(function() { setText("verification-status",t.verifyUnknown); })
      .finally(function() { button.disabled = false; });
  }

  function settle(outcome) {
    var payBtn = document.getElementById("btn-pay");
    var cancelBtn = document.getElementById("btn-cancel");
    if (payBtn) payBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    document.getElementById("btn-fail").disabled = true;
    if (payBtn) payBtn.textContent = t.working;

    fetch("/api/demo/payments/" + encodeURIComponent(authority), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: outcome })
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      if (!result.ok || !result.body.settled) {
        showError();
        return;
      }
      showCard("result-card");
      if (result.body.status === "paid") {
        setText("result-title", t.paidTitle);
        setText("result-note", t.paidNote);
        setText("result-fineprint", t.refLabel + ": " + String(result.body.provider_ref || ""));
      } else {
        setText("result-title", result.body.status === "failed" ? t.failedTitle : t.cancelledTitle);
        setText("result-note", result.body.status === "failed" ? t.failedNote : t.cancelledNote);
        var fp = document.getElementById("result-fineprint");
        if (fp) fp.hidden = true;
      }
      if (result.body.status === "paid") prepareVerification();
    }).catch(function () {
      showError();
    });
  }

  function showError() {
    showCard("error-card");
    setText("error-title", t.errorTitle);
    setText("error-note", t.errorNote);
  }

  function init() {
    applyLanguage();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(authority)) {
      showError();
      return;
    }
    fetch("/api/demo/payments/" + encodeURIComponent(authority), {
      headers: { accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) throw new Error("status " + response.status);
      return response.json();
    }).then(function (session) {
      verification = session.verification || null;
      formatAmounts(session.amount_minor);
      setText("description", String(session.description || ""));
      statusPill(session.status);
      formatExpiry(session.expires_at);
      showCard("session-card");
      var payBtn = document.getElementById("btn-pay");
      var cancelBtn = document.getElementById("btn-cancel");
      if (payBtn) payBtn.addEventListener("click", function () { settle("paid"); });
      if (cancelBtn) cancelBtn.addEventListener("click", function () { settle("cancelled"); });
      document.getElementById("btn-fail").addEventListener("click", function () { settle("failed"); });
      if (session.status && session.status !== "issued") {
        if (payBtn) payBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;
        document.getElementById("btn-fail").disabled = true;
        if (session.status === "paid") {
          showCard("result-card"); setText("result-title",t.paidTitle); setText("result-note",t.paidNote);
          document.getElementById("result-fineprint").hidden = true;
          prepareVerification();
        }
      }
    }).catch(function () {
      setText("error-note", t.loadFail);
      showError();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  document.getElementById("btn-verify").addEventListener("click", verify);
})();
