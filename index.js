/**
 * =========================================
 * Techles Planning – Gmail Drafts + Calendar Sync
 * =========================================
 * - Kolommen dynamisch via headers (met normalisatie; extra spaties in headers oké)
 * - Drafts via Instellingen (D/E/F/G vanaf rij 3)
 * - Calendar events: bron = 'Definitieve datum' (meerdere regels toegestaan)
 * - Status wijziging => conceptmail maken (of vernieuwen als template verandert)
 * - Status=Bevestiging => kalender sync (delete + recreate)
 * - Wijziging Definitieve datum => alleen sync als Status al Bevestiging is
 * - Status=Reset => logging leeg + events verwijderen
 */

/**
 * =========================================
 * CONFIG
 * =========================================
 */
const SHEET_MAIN = "Aanvragen en Planning";
const SHEET_SETTINGS = "Instellingen";
const SHEET_PROVIDERS = "Aanbieders";

const CALENDAR_ID =
  "c_31bad5e42f4418281b5d51c7e989dc6ed337392554f095e1cc5ae5233b29b46a@group.calendar.google.com";

// Instellingen templates: D/E/F/G/H vanaf rij 3
const SETTINGS_START_ROW = 3;
const SETTINGS_COL = { key: 4, subject: 5, body: 6, label: 7, emailTarget: 8 }; // D..H

// Instellingen Signature bevat bv. "me" of "info@..."
const SETTINGS_SIGNATURE_SENDAS_CELL = "B3"; 

// Status -> TemplateKey mapping (exact match met je dropdown)
const STATUS_TO_TEMPLATE = {
  "Contact gelegd": "AFSTEMMING",
  "Optie": "VOORSTEL",
  "Bevestiging": "BEVESTIGING",
  "Akkoord": "AKKOORD",
};

// Reset via status
const ENABLE_RESET_STATUS = true;
const RESET_STATUS_VALUE = "Reset";

// Veiligheid: maak niet opnieuw een concept als er al een draftId staat
// (maar: als templateKey verandert, maken we wél een nieuwe draft)
const DONT_DUPLICATE_IF_DRAFT_EXISTS = true;

/**
 * ✅ Eén plek om je sheet-headers te beheren.
 * Let op: jouw headers mogen extra spaties bevatten; we normaliseren.
 */
const COL_HEADERS = {
  aanvraagId: 'Aanvraag ID',
  school: "Schoolnaam",
  contact: "Contactpersoon",
  email: "E-mailadres",
  gemeente: "Gemeente / Regio",
  groep: "Groep / leerjaar",
  aantal_leerlingen: "Aantal leerlingen",

  workshop: "Workshopnaam",
  aanbieder: "Aanbieder",
  aantal: "Lesmomenten",
  datum: "Definitieve datum", // bron voor kalender (mag meerdere regels bevatten)
  locatie: "Locatie",
  type: "Type", // optioneel

  totale_kosten: "Totale kosten aanbieder",

  status: "Status",
  lastContact: "Laatste contactdatum",
  actieNodig: "Actie nodig", // optioneel

  conceptType: "Email Concept type",
  conceptMadeAt: "Email aangemaakt op",
  draftId: "Email Concept ID",

  notes: "Notities",
  debug: "Debug info",

  calendarEventIds: "Calendar Event IDs",
};

// Welke keys mogen ontbreken zonder dat het script faalt?
const OPTIONAL_COL_KEYS = new Set(["actieNodig", "type"]);

// runtime map: key -> colIndex
let COL = {};

/**
 * =========================================
 * TRIGGER: onOpen (Add menu-item to authorize)
 * =========================================
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Techles Admin")
    // .addItem("Authorize Gmail API", "AUTH_GMAILAPI")
    .addItem("Authorize GMAIL", "authorizeGmail_")
    .addItem("Test Gmail signature (active row)", "TEST_GMAILAPI_readSignatureForMe")
    .addToUi();
}

function AUTH_GMAILAPI() {
  // minimale call die Gmail scope vereist -> triggert autorisatie flow
  Gmail.Users.getProfile(getSendAsIdFromSettings_());
  SpreadsheetApp.getUi().alert("✅ Gmail API autorisatie lijkt gelukt. Je kunt nu de test runnen.");
}

function authorizeGmail_() {
  const result = Gmail.Users.Settings.SendAs.list('me');
  console.log(result.sendAs || []);
}


/**
 * =========================================
 * TRIGGER: handleEdit (installable trigger aanbevolen)
 * Voeg deze ook toe bij Triggers (in de sidebar) met de waarde "head" en "on edit"
 * =========================================
 */
function handleEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_MAIN) return;

  initCols_(sheet);

  const row = e.range.getRow();
  if (row < 2) return; // header

  const editedCol = e.range.getColumn();

  // ✅ Luister naar Definitieve datum, maar alleen als status al Bevestiging is
  if (editedCol === COL.datum) {
    const statusNow = String(sheet.getRange(row, COL.status).getValue() || "").trim();
    if (statusNow === "Bevestiging" || statusNow === "Akkoord") {
      syncCalendarForRow_(sheet, row);
    }
    return;
  }

  // Alleen reageren als Status is aangepast
  if (editedCol !== COL.status) return;

  const statusValue = String(e.range.getValue() || "").trim();

  // Reset via Status
  if (ENABLE_RESET_STATUS && statusValue === RESET_STATUS_VALUE) {
    resetRow_(sheet, row);
    e.range.setValue("");
    return;
  }

  const templateKey = STATUS_TO_TEMPLATE[statusValue];
  if (!templateKey) return;

  // ✅ Conceptmail aanmaken bij statuswijziging
  // - als er nog geen draftId is => maken
  // - als templateKey verschilt van conceptType => nieuwe draft maken
  // - als draft bestaat en templateKey gelijk is => overslaan (als DONT_DUPLICATE_IF_DRAFT_EXISTS = true)
  const existingDraftId = String(sheet.getRange(row, COL.draftId).getValue() || "").trim();
  const existingType = String(sheet.getRange(row, COL.conceptType).getValue() || "").trim();

  const shouldCreateDraft =
    !existingDraftId || existingType !== templateKey || !DONT_DUPLICATE_IF_DRAFT_EXISTS;

  if (shouldCreateDraft) {
    createDraftFromSheetTemplate_(row, templateKey);
  }

  // ✅ Kalender bij bevestiging: altijd syncen
  if (templateKey === "BEVESTIGING") {
    syncCalendarForRow_(sheet, row);
  }
}

/**
 * =========================================
 * Gmail: Draft + logging + label
 * =========================================
 */
function createDraftFromSheetTemplate_(row, templateKey) {
  const ss = SpreadsheetApp.getActive();
  const main = ss.getSheetByName(SHEET_MAIN);
  const settings = ss.getSheetByName(SHEET_SETTINGS);

  initCols_(main);

  const email = String(main.getRange(row, COL.email).getValue() || "").trim();
  if (!email) {
    debug_(main, row, "Geen conceptmail gemaakt: E-mailadres is leeg.");
    return;
  }
  
  const providerName = String(main.getRange(row, COL.aanbieder).getValue() || "").trim()
  const provider = getProviderInfoByName_(providerName) || {};
  if (providerName && !provider.name) {
    debug_(main, row, "Aanbieder niet gevonden in '" + SHEET_PROVIDERS + "': " + providerName);
  }

  const totaleKosten = String(main.getRange(row, COL.totale_kosten).getValue() || "");

  const tpl = getTemplateByKey_(settings, templateKey);
  if (!tpl) {
    throw new Error(
      "TemplateKey '" +
        templateKey +
        "' niet gevonden in '" +
        SHEET_SETTINGS +
        "' (kolom D, vanaf rij " +
        SETTINGS_START_ROW +
        ")."
    );
  }

  const data = {
    "{{AANVRAAG_ID}}": String(main.getRange(row, COL.aanvraagId).getValue() || ""),
    "{{SCHOOL}}": String(main.getRange(row, COL.school).getValue() || ""),
    "{{NAAM}}": String(main.getRange(row, COL.contact).getValue() || ""),
    "{{EMAIL}}": String(email || ""),
    "{{GEMEENTE}}": String(main.getRange(row, COL.gemeente).getValue() || ""),
    "{{WORKSHOP}}": String(main.getRange(row, COL.workshop).getValue() || ""),
    "{{AANBIEDER}}": providerName,
    "{{AANBIEDER_CONTACT}}": provider.contact || "",
    "{{AANBIEDER_EMAIL}}": provider.email || "",
    "{{AANBIEDER_TELEFOON}}": provider.phone || "",
    "{{GROEP}}": String(main.getRange(row, COL.groep).getValue() || ""),
    "{{AANTAL_LEERLINGEN}}": String(main.getRange(row, COL.aantal_leerlingen).getValue() || ""),
    "{{AANTAL}}": String(main.getRange(row, COL.aantal).getValue() || ""),
    "{{DATUM}}": formatDate_(main.getRange(row, COL.datum).getValue()),
    "{{PRETTY_DATUM}}": formatWorkshopDatesGrouped_(main.getRange(row, COL.datum).getValue()),
    "{{LOCATIE}}": String(main.getRange(row, COL.locatie).getValue() || ""),
    "{{TOTALE_KOSTEN}}": formatNumberNl_(totaleKosten),
  };

  const subject = replaceAll_(tpl.subject, data);
  const bodyText = replaceAll_(tpl.body, data);
  let bodyHtml = textToHtml_(bodyText);

  // Signature ophalen
  const sigHtml = getGmailSignatureHtmlFromSettings_();
  bodyHtml = appendSignatureHtml_(bodyHtml, sigHtml);

  // Target email
  const emailTarget =
    tpl.emailTarget === "School"
      ? String(main.getRange(row, COL.email).getValue() || "").trim()
      : tpl.emailTarget === "Aanbieder"
      ? String(provider.email || "").trim()
      : "";

  const draft = GmailApp.createDraft(emailTarget, subject, bodyText, { htmlBody: bodyHtml });

  // ✅ Loggen
  const now = new Date();
  main.getRange(row, COL.conceptType).setValue(templateKey);
  main.getRange(row, COL.conceptMadeAt).setValue(now);
  main.getRange(row, COL.draftId).setValue(draft.getId());
  main.getRange(row, COL.lastContact).setValue(now);
  SpreadsheetApp.flush();

  // 🏷️ Labelen (op thread)
  try {
    if (tpl.label) {
      const label = getOrCreateLabel_(tpl.label);
      draft.getMessage().getThread().addLabel(label);
    }
  } catch (err) {
    debug_(main, row, "Label-fout: " + (err && err.message ? err.message : err));
  }
}

/**
 * =========================================
 * Calendar helpers: sync + delete
 * =========================================
 */
function syncCalendarForRow_(main, row) {
  initCols_(main);
  deleteCalendarEventsForRow_(main, row);
  main.getRange(row, COL.calendarEventIds).clearContent();
  SpreadsheetApp.flush();
  createCalendarEventsForRow_(main, row);
}

function deleteCalendarEventsForRow_(main, row) {
  initCols_(main);

  const idsRaw = String(main.getRange(row, COL.calendarEventIds).getValue() || "").trim();
  if (!idsRaw) return;

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error("Calendar niet gevonden. Check CALENDAR_ID.");

  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    try {
      const ev = calendar.getEventById(id);
      if (ev) ev.deleteEvent();
    } catch (err) {
      debug_(main, row, "Calendar-delete waarschuwing (eventId " + id + "): " + (err && err.message ? err.message : err));
    }
  }
}

/**
 * =========================================
 * Calendar: events maken vanuit Definitieve datum
 * =========================================
 * Formaat per regel in cel 'Definitieve datum':
 * dd-mm-jjjj HH:MM-HH:MM
 */
function createCalendarEventsForRow_(main, row) {
  initCols_(main);

  // (optioneel) start clean
  clearDebug_(main, row);

  // Voorkom dubbel aanmaken
  const existing = String(main.getRange(row, COL.calendarEventIds).getValue() || "").trim();
  if (existing) return;

  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) throw new Error("Calendar niet gevonden. Check CALENDAR_ID.");

  const providerName = String(main.getRange(row, COL.aanbieder).getValue() || "").trim()
  const provider = getProviderInfoByName_(providerName) || {};
  if (providerName && !provider.name) {
    debug_(main, row, "Aanbieder niet gevonden in '" + SHEET_PROVIDERS + "': " + providerName);
  }

  const school = String(main.getRange(row, COL.school).getValue() || "");
  const aantal_leerlingen = String(main.getRange(row, COL.aantal_leerlingen).getValue() || "");
  const groep = String(main.getRange(row, COL.groep).getValue() || "");
  const workshop = String(main.getRange(row, COL.workshop).getValue() || "");
  const locatie = String(main.getRange(row, COL.locatie).getValue() || "");
  const type = COL.type ? String(main.getRange(row, COL.type).getValue() || "") : "";
  const contact = String(main.getRange(row, COL.contact).getValue() || "");
  const email = String(main.getRange(row, COL.email).getValue() || "");


  const momentsRaw = String(main.getRange(row, COL.datum).getValue() || "").trim();
  if (!momentsRaw) {
    debug_(main, row, "Geen kalender-event gemaakt: 'Definitieve datum' is leeg.");
    return;
  }

  const lines = momentsRaw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const createdIds = [];

  for (const line of lines) {
    const m = line.match(
      /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/
    );
    if (!m) {
      debug_(main, row, 'Ongeldig formaat in Definitieve datum: "' + line + '" (gebruik dd-mm-jjjj HH:MM-HH:MM)');
      continue;
    }

    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    const sh = parseInt(m[4], 10);
    const sm = parseInt(m[5], 10);
    const eh = parseInt(m[6], 10);
    const em = parseInt(m[7], 10);

    const start = new Date(year, month, day, sh, sm, 0);
    const end = new Date(year, month, day, eh, em, 0);

    // ✅ Type toegevoegd
    const title = "Workshop: " + workshop + " — " + school + (type ? " [" + type + "]" : "");
    const description =
      "Aanbieder: " + providerName + "\n" +
      (provider.email ? `Aanbieder email: ${provider.email}\n` : "") +
      "Contact school: " + contact + " (" + email + ")\n" +
      "Groep: " + groep + " - " + aantal_leerlingen + " leerlingen\n" +
      "Locatie: " + locatie + "\n" +
      (type ? "Type: " + type + "\n" : "");

    const event = calendar.createEvent(title, start, end, {
      location: locatie,
      description: description,
    });

    createdIds.push(event.getId());
  }

  if (!createdIds.length) {
    debug_(main, row, "Geen kalender-event gemaakt: geen geldige regels in 'Definitieve datum'.");
    return;
  }

  main.getRange(row, COL.calendarEventIds).setValue(createdIds.join(","));
}

/**
 * =========================================
 * Signature helper
 * =========================================
 */
function getSendAsIdFromSettings_() {
  const ss = SpreadsheetApp.getActive();
  const settings = ss.getSheetByName(SHEET_SETTINGS);
  const v = String(settings.getRange(SETTINGS_SIGNATURE_SENDAS_CELL).getValue() || "").trim();
  return v || "me";
}

function getGmailSignatureHtmlFromSettings_() {
  const userId = "me";
  const desired = String(getSendAsIdFromSettings_() || "").trim(); // liefst emailadres

  const list = Gmail.Users.Settings.SendAs.list(userId);
  const items = (list && list.sendAs) ? list.sendAs : [];

  // 1) als B3 matcht met een bestaande sendAsEmail -> gebruik die
  let chosen = items.find(x => x.sendAsEmail === desired);

  // 2) als B3 leeg of "me" of geen match -> pak de primary
  if (!chosen) chosen = items.find(x => x.isPrimary) || items[0];

  return (chosen && chosen.signature) ? String(chosen.signature) : "";
}


function appendSignatureHtml_(htmlBody, signatureHtml) {
  const body = String(htmlBody || "");
  const sig = String(signatureHtml || "").trim();
  if (!sig) return body;
  if (body.includes(sig)) return body; // voorkom dubbel

  return body + "\n<br>\n" + sig;
}

/**
 * =========================================
 * Reset helper
 * =========================================
 */
function resetRow_(sheet, row) {
  initCols_(sheet);

  // Events uit kalender verwijderen
  deleteCalendarEventsForRow_(sheet, row);

  sheet.getRange(row, COL.conceptType).clearContent();
  sheet.getRange(row, COL.conceptMadeAt).clearContent();
  sheet.getRange(row, COL.draftId).clearContent();
  sheet.getRange(row, COL.lastContact).clearContent();
  sheet.getRange(row, COL.calendarEventIds).clearContent();
}

/**
 * =========================================
 * Templates from Instellingen (D/E/F/G/H)
 * =========================================
 */
function getTemplateByKey_(settingsSheet, templateKey) {
  const lastRow = settingsSheet.getLastRow();
  if (lastRow < SETTINGS_START_ROW) return null;

  const numRows = lastRow - SETTINGS_START_ROW + 1;
  const values = settingsSheet.getRange(SETTINGS_START_ROW, SETTINGS_COL.key, numRows, 5).getValues();

  for (const r of values) {
    const key = String(r[0] || "").trim();
    if (key === templateKey) {
      return {
        subject: String(r[1] || ""),
        body: String(r[2] || ""),
        label: String(r[3] || "").trim(),
        emailTarget: String(r[4] || "").trim(),
      };
    }
  }
  return null;
}

/**
 * =========================================
 * Column sync (headers -> COL indices)
 * =========================================
 */
function normalizeHeader_(h) {
  return String(h || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function initCols_(sheet) {
  const lastCol = sheet.getLastColumn();
  const rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  const headerToIndex = {};
  rawHeaders.forEach((h, i) => {
    const norm = normalizeHeader_(h);
    if (norm && !headerToIndex[norm]) headerToIndex[norm] = i + 1;
  });

  const missing = [];
  const map = {};

  for (const key in COL_HEADERS) {
    const expectedNorm = normalizeHeader_(COL_HEADERS[key]);
    const idx = headerToIndex[expectedNorm];

    if (!idx) {
      if (!OPTIONAL_COL_KEYS.has(key)) missing.push(COL_HEADERS[key]);
      map[key] = null;
      continue;
    }
    map[key] = idx;
  }

  if (missing.length) {
    throw new Error(
      "Deze headers ontbreken (na normalisatie) in rij 1 van '" +
        sheet.getName() +
        "':\n- " +
        missing.join("\n- ")
    );
  }

  COL = map;
  return COL;
}

/**
 * =========================================
 * Health checks + test helpers
 * =========================================
 */
function HEALTHCHECK_all() {
  const ss = SpreadsheetApp.getActive();
  const main = ss.getSheetByName(SHEET_MAIN);
  const settings = ss.getSheetByName(SHEET_SETTINGS);

  if (!main) throw new Error("Sheet '" + SHEET_MAIN + "' niet gevonden.");
  if (!settings) throw new Error("Sheet '" + SHEET_SETTINGS + "' niet gevonden.");

  initCols_(main);

  const keysToCheck = ["AFSTEMMING", "VOORSTEL", "BEVESTIGING", "AKKOORD"];
  const missingTpl = keysToCheck.filter((k) => !getTemplateByKey_(settings, k));
  if (missingTpl.length) {
    throw new Error("Templates ontbreken in Instellingen (kolom D): " + missingTpl.join(", "));
  }

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error("Calendar niet gevonden. Check CALENDAR_ID.");

  Logger.log("✅ HEALTHCHECK: headers, templates en calendar zijn aanwezig.");
}

function TEST_makeCalendarEventsForActiveRow() {
  const ss = SpreadsheetApp.getActive();
  const main = ss.getSheetByName(SHEET_MAIN);
  initCols_(main);

  const row = main.getActiveRange().getRow();
  if (row < 2) throw new Error("Selecteer een datarij (niet header).");

  syncCalendarForRow_(main, row);
  Logger.log("✅ Calendar sync gedaan voor rij " + row);
}

function TEST_makeDraftForActiveRow_AFSTEMMING() {
  const ss = SpreadsheetApp.getActive();
  const main = ss.getSheetByName(SHEET_MAIN);
  initCols_(main);

  const row = main.getActiveRange().getRow();
  if (row < 2) throw new Error("Selecteer een datarij (niet header).");

  createDraftFromSheetTemplate_(row, "AFSTEMMING");
  Logger.log("✅ Draft gemaakt voor rij " + row);
}

function TEST_GMAILAPI_readSignatureForMe() {
  const ss = SpreadsheetApp.getActive();
  const main = ss.getSheetByName(SHEET_MAIN);
  initCols_(main);

  const row = main.getActiveRange().getRow();
  if (row < 2) throw new Error("Selecteer een datarij (niet header).");

  // Test Gmail API: users.settings.sendAs.get
  const sendAs = Gmail.Users.Settings.SendAs.get("me", Session.getActiveUser().getEmail());
  const sig = (sendAs && sendAs.signature) ? String(sendAs.signature) : "";

  // Log in debug kolom (of pas aan als jij andere naam gebruikt)
  if (COL.debug) main.getRange(row, COL.debug).setValue("✅ Gmail API OK. signature length=" + sig.length);

  Logger.log("✅ Gmail API OK. signature length=" + sig.length);
}


/**
 * =========================================
 * Utilities
 * =========================================
 */
function getProviderInfoByName_(providerName) {
  const name = String(providerName || "").trim();
  if (!name) return null;

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_PROVIDERS);
  if (!sh) throw new Error("Sheet '" + SHEET_PROVIDERS + "' niet gevonden.");

  // Pas aan als jouw aanbieders-tab anders is:
  const COLS = { name: 1, contact: 2, email: 3, phone: 4 }; // A/B/C/D

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;

  const values = sh.getRange(2, 1, lastRow - 1, Math.max(COLS.phone, COLS.email, COLS.contact)).getValues();

  for (const r of values) {
    const n = String(r[COLS.name - 1] || "").trim();
    if (n.toLowerCase() === name.toLowerCase()) {
      return {
        name: n,
        contact: String(r[COLS.contact - 1] || "").trim(),
        email: String(r[COLS.email - 1] || "").trim(),
        phone: String(r[COLS.phone - 1] || "").trim(),
      };
    }
  }
  return null;
}

function getOrCreateLabel_(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);
  return label;
}

function debug_(sheet, row, message) {
  initCols_(sheet);
  if (!COL.debug) return;
  const existing = String(sheet.getRange(row, COL.debug).getValue() || "");
  sheet.getRange(row, COL.debug).setValue(existing ? existing + "\n" + message : message);
}

function clearDebug_(sheet, row) {
  initCols_(sheet);
  if (!COL.debug) return;
  sheet.getRange(row, COL.debug).clearContent();
}

function replaceAll_(text, map) {
  let out = String(text || "");
  Object.keys(map).forEach((k) => (out = out.split(k).join(map[k] ?? "")));
  return out;
}

function formatDate_(value) {
  if (value === null || value === undefined || value === "") return "";

  const tz = Session.getScriptTimeZone();

  // 1) Als het een echte Date is (Sheets date/datetime)
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    // Met tijd als er tijd aanwezig is (niet middernacht)
    const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;
    const fmt = hasTime ? "dd-MM-yyyy HH:mm" : "dd-MM-yyyy";
    return Utilities.formatDate(value, tz, fmt);
  }

  // 2) Anders: behandel als tekst (kan multiline zijn)
  let text = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return "";

  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);

  const out = lines.map(line => {
    // a) dd-mm-jjjj HH:MM-HH:MM  (we houden tijden zoals ze zijn)
    let m = line.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2}))$/);
    if (m) {
      const dd = String(m[1]).padStart(2, "0");
      const mm = String(m[2]).padStart(2, "0");
      const yyyy = m[3];
      // tijden exact laten staan (maar je kunt hier ook padStart doen als je wil)
      const rest = m[4]; // inclusief spatie + tijd-range
      return `${dd}-${mm}-${yyyy}${rest}`;
    }

    // b) dd-mm-jjjj HH:MM (single time)
    m = line.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (m) {
      const dd = String(m[1]).padStart(2, "0");
      const mm = String(m[2]).padStart(2, "0");
      const yyyy = m[3];
      const hh = String(m[4]).padStart(2, "0");
      const min = m[5];
      return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
    }

    // c) dd-mm-jjjj (alleen datum)
    m = line.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m) {
      const dd = String(m[1]).padStart(2, "0");
      const mm = String(m[2]).padStart(2, "0");
      const yyyy = m[3];
      return `${dd}-${mm}-${yyyy}`;
    }

    // d) Fallback: probeer Date parsing (laat originele lijn staan als het niet lukt)
    const parsed = new Date(line);
    if (!isNaN(parsed.getTime())) {
      const fmt = "dd-MM-yyyy HH:mm";
      return Utilities.formatDate(parsed, tz, fmt);
    }

    return line; // onbekend formaat: laat staan
  });

  return out.join("\n");
}


function textToHtml_(text) {
  if (!text) return "";

  let t = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasHtmlTags = /<\/?[a-z][\s\S]*>/i.test(t);

  if (hasHtmlTags) {
    t = t.replace(/\n/g, "<br>\n");
    return `
      <div style="font-family: Verdana, Arial, sans-serif; font-size: 10pt; line-height: 1.4;">
        ${t}
      </div>
    `;
  }

  const paragraphs = t
    .split(/\n\s*\n/)
    .map(
      (p) =>
        `<p style="font-family: Verdana, Arial, sans-serif; font-size: 10pt; line-height: 1.4; margin: 0 0 10px 0;">${p.replace(
          /\n/g,
          "<br>\n"
        )}</p>`
    )
    .join("\n");

  return paragraphs;
}

function formatWorkshopDatesGrouped_(input) {
  if (!input) return "";

  const text = String(input);

  const re = /(\b\d{1,2})[-\/](\d{1,2})[-\/](\d{4})\b/g;

  const dates = [];
  let m;

  while ((m = re.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);

    const dt = new Date(year, month - 1, day);

    if (
      dt.getFullYear() === year &&
      dt.getMonth() === month - 1 &&
      dt.getDate() === day
    ) {
      dates.push(dt);
    }
  }

  if (dates.length === 0) return "";

  // Sorteer chronologisch
  dates.sort((a, b) => a - b);

  // Deduplicate
  const unique = [];
  const seen = new Set();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(d);
    }
  }

  const monthsNl = [
    "januari", "februari", "maart", "april", "mei", "juni",
    "juli", "augustus", "september", "oktober", "november", "december"
  ];

  // Groeperen per maand+jaar
  const grouped = {};

  unique.forEach(dt => {
    const key = dt.getFullYear() + "-" + dt.getMonth();
    if (!grouped[key]) {
      grouped[key] = {
        year: dt.getFullYear(),
        month: dt.getMonth(),
        days: []
      };
    }
    grouped[key].days.push(dt.getDate());
  });

  const parts = Object.values(grouped).map(group => {
    const daysText = joinNl_(group.days.map(String));
    const monthName = monthsNl[group.month];
    return `${daysText} ${monthName}`;
  });

  return joinNl_(parts);
}

function joinNl_(parts) {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} en ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} en ${parts[parts.length - 1]}`;
}

function formatNumberNl_(value, decimals = 2) {
  if (value === null || value === "" || value === undefined) return "";
  const num = coerceToNumber_(value);
  if (num === null) return String(value);

  return new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
}

function coerceToNumber_(value) {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    let s = value.trim();
    if (!s) return null;

    // haal € en spaties weg
    s = s.replace(/€/g, "").replace(/\s/g, "");

    // Als het NL-notatie is: 1.234,56 -> 1234.56
    // Als het EN-notatie is: 1234.56 blijft 1234.56
    // Heuristiek: als er een komma in zit, is komma decimal en punten duizendtallen
    if (s.includes(",")) {
      s = s.replace(/\./g, "").replace(",", ".");
    }

    const num = Number(s);
    return Number.isFinite(num) ? num : null;
  }

  return null;
}

