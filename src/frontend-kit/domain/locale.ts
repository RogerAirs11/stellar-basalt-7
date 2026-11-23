/**
 * R88 agent plan P20: shared field labels, date semantics and honest state
 * copy for the four P20 domains, bilingual EN/FA. LOCALE RESOURCES ONLY —
 * each skin composes its own pages around them (no shared components, no
 * shared CSS). The honest phrases come from the API modules themselves so
 * the frontend can never soften them.
 */

import { uiText, type UiLocale } from "../../shared/uiLocale";
export type Locale = UiLocale;

export interface BilingualText { en: string; fa: string }

export function pick(text: BilingualText, locale: Locale): string {
  return uiText(locale, text.en, text.fa);
}

/** Money display: internal unit is integer minor IRR; toman is display-only (1 toman = 10 rial). */
export const MONEY = {
  currencyInternal: { en: "Amounts are stored in integer rial (IRR).", fa: "مبالغ به ریال صحیح (IRR) ذخیره می‌شوند." },
  tomanNote: { en: "Toman is a display conversion only (1 toman = 10 rial); nothing is charged in toman.", fa: "تومان فقط تبدیل نمایشی است (۱ تومان = ۱۰ ریال)؛ پرداختی به تومان انجام نمی‌شود." },
  pilotNote: { en: "Offer prices are pilot hypotheses, not verified market rates.", fa: "قیمت پیشنهادها فرضیه آزمایشی هستند، نه نرخ‌های تأییدشده بازار." },
} as const;

/** Shared resource-state copy. An error is never evidence that no records exist. */
export const RESOURCE_STATES = {
  loading: { en: "Loading…", fa: "در حال بارگذاری…" },
  reloading: { en: "Showing the previously loaded data while it is being refreshed — it may be stale.", fa: "داده قبلی تا هنگام به‌روزرسانی نمایش داده می‌شود — ممکن است قدیمی باشد." },
  empty: { en: "Nothing here yet.", fa: "هنوز چیزی اینجا نیست." },
  forbidden: { en: "You do not have access to this.", fa: "شما به این بخش دسترسی ندارید." },
  unavailable: { en: "This is not available.", fa: "این بخش در دسترس نیست." },
  error: { en: "This could not be loaded. An error is not evidence that nothing exists.", fa: "بارگذاری ناموفق بود. خطا به معنی نبودِ داده نیست." },
  retry: { en: "Retry", fa: "تلاش دوباره" },
} as const;

export const DIRECTORY = {
  title: { en: "Professional directory", fa: "فهرست متخصصان" },
  persons: { en: "People", fa: "افراد" },
  organizations: { en: "Organizations", fa: "سازمان‌ها" },
  category: { en: "Service category", fa: "دسته خدمت" },
  province: { en: "Province", fa: "استان" },
  city: { en: "City", fa: "شهر" },
  languages: { en: "Languages", fa: "زبان‌ها" },
  availability: { en: "Availability", fa: "دسترسی" },
  contactPreference: { en: "Contact preference", fa: "ترجیح تماس" },
  contactMediated: { en: "Contact is mediated by the platform per the stated preference.", fa: "تماس مطابق ترجیح اعلام‌شده از طریق سامانه برقرار می‌شود." },
  credentials: { en: "Credentials", fa: "مدارک" },
  credentialActive: { en: "Active", fa: "فعال" },
  credentialExpired: { en: "Expired (kept as history)", fa: "منقضی (به‌عنوان سابقه نگه‌داشته شده)" },
  verification: { en: "Verification", fa: "وضعیت تأیید" },
  unverified: { en: "Self-declared (unverified)", fa: "خوداظهاری (تأییدنشده)" },
  credentialsNote: { en: "Credentials are self-declared until platform-reviewed or issuer-attested; expired credentials remain as history without an active state.", fa: "مدارک تا بررسی سامانه یا گواهی صادرکننده خوداظهاری‌اند؛ مدرک منقضی به‌عنوان سابقه می‌ماند بدون وضعیت فعال." },
} as const;

export const SERVICE_REQUESTS = {
  title: { en: "Service requests", fa: "درخواست خدمات" },
  mine: { en: "My requests", fa: "درخواست‌های من" },
  inbox: { en: "Provider inbox", fa: "صندوق ورودی ارائه‌دهنده" },
  notAppointment: { en: "A service request is not a confirmed appointment.", fa: "درخواست خدمت، نوبت تأییدشده نیست." },
  lead: { en: "This is a lead, not a confirmed appointment. The provider sees your contact route only if you consented.", fa: "این یک درخواست اولیه است، نه نوبت تأییدشده. ارائه‌دهنده فقط با رضایت شما راه تماس را می‌بیند." },
  contactShared: { en: "Contact shared with this provider by explicit consent.", fa: "راه تماس با رضایت صریح با این ارائه‌دهنده به اشتراک گذاشته شده است." },
  contactNotShared: { en: "Contact is not shared with this reader.", fa: "راه تماس با این خواننده به اشتراک گذاشته نشده است." },
  notePrivate: { en: "The note stays between you and the provider.", fa: "یادداشت میان شما و ارائه‌دهنده می‌ماند." },
  status: { en: "Status", fa: "وضعیت" },
  sentAt: { en: "Sent", fa: "ارسال" },
  updatedAt: { en: "Last change", fa: "آخرین تغییر" },
} as const;

export const WORKSPACES = {
  title: { en: "Farm workspaces", fa: "فضای کار مزرعه" },
  workingSet: { en: "A workspace is a working set, not an ownership claim. Adding a horse here changes no registry ownership assertion.", fa: "فضای کار یک مجموعه کاری است، نه ادعای مالکیت. افزودن اسب اینجا هیچ ادعای مالکیت ثبت‌نامه را تغییر نمی‌دهد." },
  herd: { en: "Herd", fa: "گله" },
  tasks: { en: "Reminders", fa: "یادآورها" },
  overdue: { en: "Overdue", fa: "سررسید گذشته" },
  dueSoon: { en: "Due soon", fa: "نزدیک به سررسید" },
  later: { en: "Later", fa: "بعداً" },
  veterinaryNotice: { en: "Scheduling a veterinary appointment is not veterinary advice. Dosage and treatment decisions need a qualified person.", fa: "رزرو نوبت دامپزشکی توصیه دامپزشکی نیست. تصمیم دوز و درمان نیازمند شخص صلاحیت‌دار است." },
  staff: { en: "Staff", fa: "کارکنان" },
  revoked: { en: "Revoked", fa: "لغو شده" },
  neverDeleted: { en: "Removing a horse from a workspace never deletes the horse record.", fa: "حذف اسب از فضای کار هرگز رکورد اسب را حذف نمی‌کند." },
  staffConsent: { en: "Delegation needs consent: an owner invites, the invitee decides, and access is re-checked live on every request — a revoke takes effect immediately.", fa: "واگذاری نیازمند رضایت است: مالک دعوت می‌کند، طرف مقابل تصمیم می‌گیرد، و دسترسی در هر درخواست دوباره بررسی می‌شود — لغو فوراً اثر می‌کند." },
  documentTrackers: { en: "Document rows are trackers for paper processes — no file bytes and no medical content are stored. An expiry date is operator-entered and drives renewal reminders through date arithmetic only.", fa: "ردیف‌های مدرک فقط پیگیر فرایند کاغذی هستند — هیچ فایل یا محتوای پزشکی ذخیره نمی‌شود. تاریخ انقضا توسط بهره‌بردار وارد شده و فقط از طریق محاسبه تاریخ یادآور تمدید را می‌سازد." },
  documentHorseImmutable: { en: "A document's horse association is fixed when the tracker is created; it cannot be moved. Archive this tracker and create a new one for the other horse.", fa: "ارتباط مدرک با اسب هنگام ایجاد ثابت می‌شود و قابل تغییر نیست. این ردیف را بایگانی کنید و برای اسب دیگر ردیف جدید بسازید." },
  importNoOverwrite: { en: "Import never overwrites: an existing occurrence is skipped and reported. Rows accepted by a previous attempt of the same import report already_imported and count as accepted — an interrupted import replays to its exact accepted rows without duplicating any task.", fa: "درون‌ریزی هرگز بازنویسی نمی‌کند: مورد موجود گزارش و رد می‌شود. ردیف‌های پذیرفته‌شده در تلاش قبلی همان درون‌ریزی، «قبلاً وارد شده» گزارش می‌شوند — درون‌ریزی قطع‌شده بدون تکرار هیچ یادآوری به ردیف‌های پذیرفته‌شده واقعی می‌رسد." },
} as const;

export const BILLING = {
  title: { en: "Plans and offers", fa: "طرح‌ها و پیشنهادها" },
  catalog: { en: "Price catalog", fa: "فهرست قیمت" },
  orders: { en: "My orders", fa: "سفارش‌های من" },
  order: { en: "Order", fa: "سفارش" },
  total: { en: "Total", fa: "جمع" },
  status: { en: "Status", fa: "وضعیت" },
  pending: { en: "pending — recorded, nothing charged", fa: "در انتظار — ثبت شده، چیزی برداشت نشده" },
  trustNote: { en: "Payment buys conveniences only — never official approval, biological truth, evidence suppression, or access to another owner's private resources.", fa: "پرداخت فقط امکانات را می‌خرد — هرگز تأیید رسمی، حقیقت زیستی، پنهان‌کردن مدرک یا دسترسی به داده خصوصی دیگران را نمی‌خرد." },
  freeForever: { en: "Free forever", fa: "همیشه رایگان" },
  entitlements: { en: "My plan benefits", fa: "مزایای طرح من" },
  boundaryNote: { en: "Entitlements unlock paid conveniences only. A paid plan never grants access to another owner's private resources.", fa: "اعتبار طرح فقط امکانات پرداختی را فعال می‌کند. طرح پرداختی هرگز به داده خصوصی مالک دیگر دسترسی نمی‌دهد." },
  paymentUnavailable: { en: "Payment processing is not configured on this deployment. No charge can occur.", fa: "پردازش پرداخت روی این استقرار پیکربندی نشده است. هیچ برداشتی انجام نمی‌شود." },
  cancelled: { en: "Cancelled — financial records are retained.", fa: "لغو شد — سوابق مالی نگه‌داشته می‌شوند." },
} as const;

/** R114-04: organization staff lifecycle copy (EN/FA) — keeps user memberships,
 * person profiles and person-level officiating roles distinct. */
export const ORGANIZATION_STAFF = {
  rosterTitle: { en: "Membership and invitations", fa: "عضویت و دعوت‌ها" },
  rosterNote: { en: "Authority over an organization belongs to CURRENT user memberships only — a former employee retains nothing, not even read access to new leads.", fa: "اختیار سازمان فقط به عضویت‌های جاری کاربران تعلق دارد — کارمند سابق هیچ چیزی نگه نمی‌دارد، حتی خواندن سرنخ‌های جدید." },
  current: { en: "Current", fa: "جاری" },
  former: { en: "Former", fa: "پیشین" },
  pending: { en: "Pending", fa: "در انتظار" },
  inviteForm: { en: "Invite a user to this organization", fa: "دعوت کاربر به این سازمان" },
  inviteConsent: { en: "The invitee decides: no membership exists until they accept. Invitations expire honestly; a revoked invitation can no longer be answered.", fa: "طرف دعوت تصمیم می‌گیرد: تا پذیرش، هیچ عضویتی وجود ندارد. دعوت‌ها صادقانه منقضی می‌شوند؛ دعوت لغو‌شده دیگر قابل پاسخ نیست." },
  proposedRole: { en: "Proposed role", fa: "نقش پیشنهادی" },
  inviteNote: { en: "Note (optional)", fa: "یادداشت (اختیاری)" },
  sendInvite: { en: "Send invitation", fa: "ارسال دعوت" },
  changeRole: { en: "Change role", fa: "تغییر نقش" },
  roleChangeBlocked: { en: "Only a current owner may grant the owner role; you cannot change your own role; the last owner seat cannot be demoted.", fa: "فقط مالک جاری می‌تواند نقش مالک بدهد؛ نقش خودتان قابل تغییر نیست؛ کرسی آخر مالک نمی‌تواند تنزل یابد." },
  revokeMembership: { en: "Revoke membership", fa: "لغو عضویت" },
  revokeReason: { en: "Reason", fa: "دلیل" },
  revokeNote: { en: "Revocation takes effect immediately: the former staff member loses every organization capability (edits, inbox) — memberships are evaluated live.", fa: "لغو فوراً اثر می‌کند: کارمند سابق همه توانمندی‌های سازمان را از دست می‌دهد (ویرایش، صندوق) — عضویت‌ها زنده ارزیابی می‌شوند." },
  selfBlocked: { en: "You cannot change your own role or revoke yourself — ask another current staff member.", fa: "نقش خودتان را نمی‌توانید تغییر دهید یا خودتان را لغو کنید — از کارمند جاری دیگری بخواهید." },
  myInvitations: { en: "My pending organization invitations", fa: "دعوت‌های در انتظار سازمانی من" },
  accept: { en: "Accept", fa: "پذیرش" },
  decline: { en: "Decline", fa: "رد" },
  revokedAnswer: { en: "This invitation was revoked by the organization and can no longer be answered.", fa: "این دعوت توسط سازمان لغو شده و دیگر قابل پاسخ نیست." },
  expiredAnswer: { en: "This invitation expired; ask the organization for a new one.", fa: "این دعوت منقضی شده؛ از سازمان دعوت تازه بخواهید." },
  goneAnswer: { en: "This invitation is no longer available (already answered or removed).", fa: "این دعوت دیگر در دسترس نیست (پیش‌تر پاسخ داده شده یا حذف شده)." },
  unknownAnswer: { en: "The answer could not be delivered; its result is unknown. Check the list again before retrying.", fa: "پاسخ قابل تحویل نبود؛ نتیجه آن نامشخص است. پیش از تلاش دوباره فهرست را بررسی کنید." },
  notCurrentStaff: { en: "Only CURRENT staff can view this organization's membership roster. If your membership was just revoked, this view shows nothing further.", fa: "فقط کارکنان جاری می‌توانند فهرست عضویت این سازمان را ببینند. اگر عضویت شما تازه لغو شده، این نمای هیچ چیز بیشتری نشان نمی‌دهد." },
  personNotMembership: { en: "Memberships are user-account facts. Person profiles and person-level officiating roles (judge, steward, ringmaster, disciplinary committee) are separate entities and never appear in this roster.", fa: "عضویت‌ها واقعیت‌های حساب کاربر هستند. نمایه شخص و نقش‌های داوری شخص‌محور (داور، سرپاست، رینگ‌مستر، کمیته انضباطی) موجودیت‌های جدایی هستند و هرگز در این فهرست نیستند." },
} as const;

/** R114-05: shared workspace desk copy (EN/FA) — a workspace is a working set,
 * never an ownership claim; completion is versioned; delegation is consent-first. */
export const WORKSPACE_DESK = {
  deskTitle: { en: "Stable workspaces", fa: "فضاهای کاری اصطبل" },
  deskNote: { en: "A workspace is a working set of horses and reminders — never an ownership claim. Access is re-checked live on every request.", fa: "فضای کار مجموعه‌ای از اسب‌ها و یادآورهاست — نه ادعای مالکیت. دسترسی در هر درخواست زنده بازبینی می‌شود." },
  myWorkspaces: { en: "My workspaces", fa: "فضاهای کاری من" },
  ownerRole: { en: "Owner", fa: "مالک" },
  managerRole: { en: "Manager", fa: "مدیر" },
  staffRole: { en: "Staff", fa: "کارکنان" },
  noWorkspaces: { en: "No workspaces yet. Creation is subject to the current plan limits.", fa: "هنوز فضای کاری نیست. ایجاد تابع محدودیت طرح فعلی است." },
  createWorkspace: { en: "Create a workspace", fa: "ایجاد فضای کاری" },
  workspaceName: { en: "Workspace name", fa: "نام فضای کاری" },
  selectWorkspace: { en: "Select a workspace to see its herd, reminders, team and documents.", fa: "یک فضای کاری انتخاب کنید تا گله، یادآورها، تیم و مدارک آن را ببینید." },
  readOnlyPlan: { en: "Your plan is read-only for this workspace. Existing information and permitted exports remain available.", fa: "طرح شما برای این فضای کاری فقط‌خواندنی است. اطلاعات موجود و خروجی‌های مجاز در دسترس می‌مانند." },
  addReminder: { en: "Add reminder", fa: "افزودن یادآور" },
  reminderTitle: { en: "Title", fa: "عنوان" },
  reminderDue: { en: "Due date (Gregorian)", fa: "تاریخ سررسید (میلادی)" },
  reminderCategory: { en: "Category", fa: "دسته" },
  reminderTimezone: { en: "Timezone (IANA)", fa: "منطقه زمانی (IANA)" },
  reminderRepeat: { en: "Repeat every N calendar days (optional)", fa: "تکرار پس از N روز تقویمی (اختیاری)" },
  markComplete: { en: "Mark complete", fa: "علامت‌گذاری به‌عنوان انجام‌شده" },
  completeSuccess: { en: "Reminder completed. A recurring reminder schedules its next occurrence exactly once.", fa: "یادآور انجام شد. یادآور تکرارشونده فقط یک بار وقوع بعدی را زمان‌بندی می‌کند." },
  versionConflict: { en: "This reminder changed elsewhere; reload the current version and retry. Your intent is kept, nothing was written twice.", fa: "این یادآور جای دیگر تغییر کرده؛ نسخه فعلی را بازخوانی و دوباره تلاش کنید. نیت شما حفظ شده و چیزی دوبار نوشته نشده." },
  alreadyClosed: { en: "The reminder is already completed — nothing further was written.", fa: "یادآور پیش‌تر انجام شده — چیز دیگری نوشته نشد." },
  completedHeading: { en: "Completed reminders", fa: "یادآورهای انجام‌شده" },
  completedNote: { en: "A completed one-shot reminder can be reopened with a fresh version; the completion history stays recorded. A closed recurring occurrence cannot be reopened — its next occurrence already exists.", fa: "یادآور یک‌بارهٔ انجام‌شده با نسخه‌ای تازه بازگشایی می‌شود و تاریخچهٔ انجام آن ثبت می‌ماند. وقوع تکرارشوندهٔ بسته بازگشایی نمی‌شود — وقوع بعدی آن از قبل موجود است." },
  completedEmpty: { en: "No completed reminders in this working set yet.", fa: "هنوز یادآور انجام‌شده‌ای در این مجموعه کاری نیست." },
  reopen: { en: "Reopen", fa: "بازگشایی" },
  reopenSuccess: { en: "The completed reminder is open again with a fresh version; the completion history stays recorded and nothing was duplicated.", fa: "یادآور انجام‌شده با نسخه‌ای تازه دوباره باز شد؛ تاریخچهٔ انجام ثبت ماند و چیزی تکرار نشد." },
  notCompleted: { en: "Only a completed reminder can be reopened.", fa: "فقط یادآور انجام‌شده قابل بازگشایی است." },
  recurringCompleted: { en: "A closed recurring occurrence cannot be reopened: completing it already scheduled its next occurrence, and reopening would leave two live occurrences of the same reminder.", fa: "وقوع تکرارشوندهٔ بسته بازگشایی نمی‌شود: انجام آن وقوع بعدی را زمان‌بندی کرده و بازگشایی دو وقوع زندهٔ یک یادآور را باقی می‌گذاشت." },
  needTasksManage: { en: "You need the tasks_manage action for this workspace to manage reminders.", fa: "برای مدیریت یادآورهای این فضای کاری به اقدام tasks_manage نیاز دارید." },
  assignment: { en: "Assignment", fa: "انتساب" },
  assignReminder: { en: "Assign or unassign a reminder (versioned)", fa: "انتساب یا لغو انتساب یادآور (نسخه‌دار)" },
  assignTo: { en: "Assign to (blank = unassign)", fa: "انتساب به (خالی = لغو انتساب)" },
  herdHeading: { en: "Horses in this working set", fa: "اسب‌های این مجموعه کاری" },
  addHorseLabel: { en: "Horse ID (requires your current management grant)", fa: "شناسه اسب (نیازمند مجوز مدیریت جاری شما)" },
  removeHorse: { en: "Remove from working set", fa: "حذف از مجموعه کاری" },
  noHorses: { en: "No horses have been added to this working set.", fa: "هنوز اسبی به این مجموعه کاری اضافه نشده است." },
  staffHeading: { en: "Team and invitations", fa: "تیم و دعوت‌ها" },
  inviteStaff: { en: "Invite a staff member", fa: "دعوت کارمند" },
  inviteConsent: { en: "The invitation needs the other person's consent — no assignment exists until they accept. Invitations expire after 14 days.", fa: "دعوت نیازمند رضایت طرف مقابل است — تا پذیرش، هیچ انتسابی وجود ندارد. دعوت‌ها پس از ۱۴ روز منقضی می‌شوند." },
  revokeAccess: { en: "Revoke access", fa: "لغو دسترسی" },
  revokeSuccess: { en: "Staff access revoked. Their queued reminders for this workspace are suppressed.", fa: "دسترسی کارمند لغو شد. یادآورهای در صف او برای این فضای کاری سرکوب شد." },
  noActiveStaff: { en: "No active staff.", fa: "کارمند فعالی نیست." },
  myInvitations: { en: "My pending workspace invitations", fa: "دعوت‌های در انتظار فضای کاری من" },
  accept: { en: "Accept", fa: "پذیرش" },
  decline: { en: "Decline", fa: "رد" },
  expiredAnswer: { en: "This invitation expired; ask the workspace manager for a fresh one.", fa: "این دعوت منقضی شده؛ از مدیر فضای کاری دعوت تازه بخواهید." },
  alreadyAnswered: { en: "This invitation was already answered or revoked and cannot be answered again.", fa: "این دعوت پیش‌تر پاسخ داده شده یا لغو شده و دیگر قابل پاسخ نیست." },
  notAcceptableAnswer: { en: "The invitation could not be accepted: the inviter's authority or the staff capacity changed. Ask for a fresh invitation.", fa: "دعوت پذیرفته نشد: اختیار دعوت‌کننده یا ظرفیت کارکنان تغییر کرده. دعوت تازه بخواهید." },
  goneAnswer: { en: "This invitation is no longer available.", fa: "این دعوت دیگر در دسترس نیست." },
  unknownAnswer: { en: "The answer could not be delivered; its result is unknown. Check the list again before retrying.", fa: "پاسخ قابل تحویل نبود؛ نتیجه آن نامشخص است. پیش از تلاش دوباره فهرست را بررسی کنید." },
  forbiddenDashboard: { en: "Your access to this workspace is no longer current. Nothing further is shown for it.", fa: "دسترسی شما به این فضای کاری دیگر جاری نیست. چیز دیگری برای آن نشان داده نمی‌شود." },
  invalidDates: { en: "Reminder dates needing review", fa: "تاریخ‌های نیازمند بررسی" },
  documentsTitle: { en: "Document trackers", fa: "پیگیرهای مدرک" },
  trackDocument: { en: "Track a document", fa: "پیگیری مدرک" },
  createTracker: { en: "Create tracker", fa: "ساخت پیگیر" },
  noDocuments: { en: "No document trackers in this workspace.", fa: "در این فضای کار پیگیر مدرکی نیست." },
  includeArchived: { en: "Include archived", fa: "شامل بایگانی" },
  hideArchived: { en: "Hide archived", fa: "پنهان‌کردن بایگانی" },
  archivedReadOnly: { en: "archived — read-only history", fa: "بایگانی — تاریخچه فقط‌خواندنی" },
  saveVersioned: { en: "Save (versioned)", fa: "ذخیره (نسخه‌دار)" },
  archive: { en: "Archive", fa: "بایگانی" },
  archivedNote: { en: "Tracker archived; the paper-process history stays queryable.", fa: "پیگیر بایگانی شد؛ تاریخچه فرایند کاغذی قابل پرس‌وجو می‌ماند." },
  documentConflict: { en: "This document changed while you were editing; your draft is kept. Reload the current version and try again.", fa: "این مدرک هنگام ویرایش شما تغییر کرده؛ پیش‌نویس شما حفظ شده است. نسخه فعلی را بارگذاری و دوباره تلاش کنید." },
  horseFixed: { en: "fixed", fa: "ثابت" },
  needTasksManageDocuments: { en: "You need the tasks_manage action to track documents.", fa: "برای پیگیری مدرک نیازمند اقدام مدیریت یادآورها هستید." },
  importTitle: { en: "Import reminders (no overwrite)", fa: "درون‌ریزی یادآورها (بدون بازنویسی)" },
  importUpTo: { en: "Import up to 200 rows", fa: "درون‌ریزی تا ۲۰۰ ردیف" },
  importFinished: { en: "Import finished — every row reports its honest outcome below.", fa: "درون‌ریزی پایان یافت — نتیجه واقعی هر ردیف زیر است." },
  perRowReceipts: { en: "Per-row receipts", fa: "رسید هر ردیف" },
  importedLabel: { en: "imported", fa: "وارد شد" },
  alreadyImportedLabel: { en: "already imported by a previous attempt of this import (accepted)", fa: "قبلاً در تلاش قبلی همین درون‌ریزی پذیرفته شده (پذیرفته)" },
  occurrenceExistsLabel: { en: "an existing occurrence was skipped and reported — never overwritten", fa: "مورد موجود گزارش و رد شد — هرگز بازنویسی نشد" },
  rowRefusedLabel: { en: "the write refused this row", fa: "نوشتن این ردیف را رد کرد" },
  exportCsv: { en: "Export CSV (registry-safe fields)", fa: "خروجی CSV (فیلدهای امن ثبت‌نامه)" },
} as const;

/** Date semantics: registry dates are ISO strings that may be partial/absent; never fabricate precision. */
export const DATES = {
  notRecorded: { en: "Not recorded", fa: "ثبت نشده" },
  unknown: { en: "Unknown", fa: "نامشخص" },
} as const;
