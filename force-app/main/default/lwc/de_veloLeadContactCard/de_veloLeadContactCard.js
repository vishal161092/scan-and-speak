import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue } from "lightning/uiRecordApi";
import { loadScript } from "lightning/platformResourceLoader";
import QR_LIB from "@salesforce/resourceUrl/de_qrcodeGenerator";

// --- contact ---
import FIRST from "@salesforce/schema/Lead.FirstName";
import LAST from "@salesforce/schema/Lead.LastName";
import SALUTATION from "@salesforce/schema/Lead.Salutation";
import TITLE from "@salesforce/schema/Lead.Title";
import COMPANY from "@salesforce/schema/Lead.Company";
import PHONE from "@salesforce/schema/Lead.Phone";
import MOBILE from "@salesforce/schema/Lead.MobilePhone";
import EMAIL from "@salesforce/schema/Lead.Email";
import STREET from "@salesforce/schema/Lead.Street";
import CITY from "@salesforce/schema/Lead.City";
import STATE from "@salesforce/schema/Lead.State";
import POSTAL from "@salesforce/schema/Lead.PostalCode";
import SOURCE from "@salesforce/schema/Lead.LeadSource";
import RATING from "@salesforce/schema/Lead.Rating";
import DNC from "@salesforce/schema/Lead.DoNotCall";
import EMAILOPTOUT from "@salesforce/schema/Lead.HasOptedOutOfEmail";

// --- vehicle interest / qualification (org custom fields) ---
import MODEL from "@salesforce/schema/Lead.Model_Interest__c";
import VARIANT from "@salesforce/schema/Lead.Variant__c";
import FUEL from "@salesforce/schema/Lead.Fuel_Preference__c";
import TRANS from "@salesforce/schema/Lead.Transmission_Preference__c";
import BUDGET from "@salesforce/schema/Lead.Budget_Range__c";
import TIMEFRAME from "@salesforce/schema/Lead.Purchase_Timeframe__c";
import TESTDRIVE from "@salesforce/schema/Lead.Test_Drive_Status__c";
import TRADEIN from "@salesforce/schema/Lead.Trade_In_Vehicle__c";
import FINANCE from "@salesforce/schema/Lead.Financing_Interest__c";
import DEALER from "@salesforce/schema/Lead.Preferred_Dealership__c";
import SCORE from "@salesforce/schema/Lead.Engagement_Score__c";

const OWNER_NAME = "Lead.Owner.Name";
const FIELDS = [
  FIRST, LAST, SALUTATION, TITLE, COMPANY, PHONE, MOBILE, EMAIL,
  STREET, CITY, STATE, POSTAL, SOURCE, RATING, DNC, EMAILOPTOUT,
  MODEL, VARIANT, FUEL, TRANS, BUDGET, TIMEFRAME, TESTDRIVE, TRADEIN,
  FINANCE, DEALER, SCORE, OWNER_NAME
];

// urgency / test-drive contribution for a derived engagement score fallback
const TIME_PTS = {
  "Immediate (0-15 days)": 25,
  "Within 1 Month": 20,
  "1-3 Months": 15,
  "3-6 Months": 8,
  "Just Exploring": 3
};
const TD_PTS = { Completed: 30, Scheduled: 22, "Follow-up Needed": 12, "Not Scheduled": 4 };

export default class De_veloLeadContactCard extends LightningElement {
  @api recordId;
  lead;

  // header QR chip (display-only — encodes the Record Id)
  qrDataUrl;
  _qrLoaded = false;

  @wire(getRecord, { recordId: "$recordId", fields: FIELDS })
  wired({ data }) {
    if (data) this.lead = data;
  }

  renderedCallback() {
    if (this._qrLoaded) return;
    this._qrLoaded = true;
    loadScript(this, QR_LIB)
      .then(() => this.makeQr())
      .catch(() => { /* chip silently hides if the lib fails to load */ });
  }

  makeQr() {
    if (!this.recordId || !window.qrcode) return;
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(this.recordId);
      qr.make();
      // Bigger modules (8px) + a full 4-module quiet zone so a phone camera can
      // focus and decode this small header chip, not just the large panel QR.
      this.qrDataUrl = qr.createDataURL(8, 4);
    } catch (e) {
      this.qrDataUrl = undefined;
    }
  }

  get hasQr() { return !!this.qrDataUrl; }

  v(f) { return getFieldValue(this.lead, f); }

  // ---------- header ----------
  get first() { return this.v(FIRST) || ""; }
  get last() { return this.v(LAST) || ""; }
  get fullName() {
    const s = this.v(SALUTATION);
    const n = `${this.first} ${this.last}`.trim();
    return (s ? `${s} ` : "") + (n || "New Lead");
  }
  get initials() {
    const a = this.first ? this.first[0] : "";
    const b = this.last ? this.last[0] : "";
    return (a + b).toUpperCase() || "M";
  }

  // ---------- contact rows (skip empties) ----------
  get email() { return this.v(EMAIL); }
  get phone() { return this.v(MOBILE) || this.v(PHONE); }
  get address() {
    const parts = [this.v(STREET), this.v(CITY), this.v(STATE), this.v(POSTAL)].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  get owner() { return this.v(OWNER_NAME); }
  get source() { return this.v(SOURCE); }

  get contactRows() {
    return [
      { id: "email", label: "Email Address", value: this.email, icon: "utility:email" },
      { id: "phone", label: "Phone Number", value: this.phone, icon: "utility:phone_portrait" },
      { id: "addr", label: "Address", value: this.address, icon: "utility:location" },
      { id: "owner", label: "Lead Owner", value: this.owner, icon: "utility:user" }
    ].filter((r) => r.value);
  }

  // category pills (only render ones with a real value)
  get tags() {
    const t = [];
    const rating = this.v(RATING);
    const source = this.v(SOURCE);
    const td = this.v(TESTDRIVE);
    if (rating) t.push({ id: "rating", label: rating });
    if (source) t.push({ id: "source", label: source });
    if (td) t.push({ id: "td", label: td });
    return t;
  }
  get hasTags() { return this.tags.length > 0; }

  // ---------- vehicle interest ----------
  get model() { return this.v(MODEL); }
  get fuel() { return this.v(FUEL); }
  get isEv() {
    const f = (this.fuel || "").toLowerCase();
    return f.includes("electric") || f.includes("ev");
  }
  get vehicleSub() {
    const parts = [this.v(VARIANT), this.v(TRANS)].filter(Boolean);
    return parts.length ? parts.join("  ·  ") : null;
  }
  get vehicleTagline() {
    return this.isEv ? "Zero emissions · Eco-friendly" : null;
  }
  get vehicleIconClass() {
    return this.isEv ? "veh__icon veh__icon--ev" : "veh__icon";
  }
  get vehicleValueClass() {
    return this.isEv ? "veh__value veh__value--ev" : "veh__value";
  }
  get vehicleIcon() {
    return this.isEv ? "utility:charging_station" : "utility:travel_and_places";
  }
  get testDrive() { return this.v(TESTDRIVE); }
  get hasVehicle() { return !!(this.model || this.fuel); }

  // ---------- qualification tiles ----------
  get qualRows() {
    return [
      { id: "budget", label: "Budget Range", value: this.v(BUDGET), icon: "utility:moneybag" },
      { id: "time", label: "Purchase Timeframe", value: this.v(TIMEFRAME), icon: "utility:date_input" },
      { id: "finance", label: "Financing", value: this.v(FINANCE), icon: "utility:currency" },
      { id: "trade", label: "Trade-In Vehicle", value: this.v(TRADEIN), icon: "utility:cases" },
      { id: "dealer", label: "Preferred Dealership", value: this.v(DEALER), icon: "utility:company" }
    ].filter((r) => r.value);
  }
  get hasQual() { return this.qualRows.length > 0; }

  // ---------- engagement score ----------
  get factors() {
    return [
      { id: "model", label: "Model interest captured", pts: this.v(MODEL) ? 25 : 0, max: 25 },
      { id: "budget", label: "Budget range provided", pts: this.v(BUDGET) ? 20 : 0, max: 20 },
      { id: "time", label: "Purchase urgency", pts: TIME_PTS[this.v(TIMEFRAME)] || 0, max: 25 },
      { id: "td", label: "Test drive progress", pts: TD_PTS[this.v(TESTDRIVE)] || 0, max: 30 }
    ];
  }
  get computed() { return this.factors.reduce((s, f) => s + f.pts, 0); }
  get hasScore() {
    return (this.v(SCORE) !== undefined && this.v(SCORE) !== null) || this.computed > 0;
  }
  get score() {
    const explicit = this.v(SCORE);
    const val = explicit !== undefined && explicit !== null ? explicit : this.computed;
    return Math.max(0, Math.min(100, Math.round(val)));
  }
  get band() {
    const s = this.score;
    if (s >= 70) return "Hot";
    if (s >= 40) return "Warm";
    return "Cold";
  }
  get bandClass() {
    const b = this.band;
    if (b === "Hot") return "score__band score__band--hot";
    if (b === "Warm") return "score__band score__band--warm";
    return "score__band score__band--cold";
  }
  get barFillClass() {
    const b = this.band;
    if (b === "Hot") return "score__fill score__fill--hot";
    if (b === "Warm") return "score__fill score__fill--warm";
    return "score__fill score__fill--cold";
  }
  get barStyle() { return `width:${this.score}%`; }
  get keyFactors() {
    return this.factors.map((f) => {
      const pct = Math.round((f.pts / f.max) * 100);
      return {
        id: f.id,
        label: f.label,
        pts: f.pts,
        max: f.max,
        score: `${f.pts}/${f.max}`,
        dotClass: f.pts > 0 ? "kf__dot kf__dot--on" : "kf__dot kf__dot--off",
        fillClass: f.pts > 0 ? `kf__fill kf__fill--${this.band.toLowerCase()}` : "kf__fill kf__fill--empty",
        fillStyle: `width:${pct}%`
      };
    });
  }

  // ---------- consent ----------
  get consentFlags() {
    const flags = [];
    if (this.v(DNC)) flags.push({ id: "dnc", label: "Do Not Call" });
    if (this.v(EMAILOPTOUT)) flags.push({ id: "eo", label: "Email Opt-Out" });
    return flags;
  }
  get hasConsentFlags() { return this.consentFlags.length > 0; }

  // ---------- actions ----------
  callPhone() {
    const p = this.v(MOBILE) || this.v(PHONE);
    if (p) window.open(`tel:${p}`);
  }
  sendEmail() {
    const e = this.v(EMAIL);
    if (e) window.open(`mailto:${e}`);
  }
}
