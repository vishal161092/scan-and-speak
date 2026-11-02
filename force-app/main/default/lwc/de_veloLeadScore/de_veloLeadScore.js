import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue } from "lightning/uiRecordApi";
import SCORE from "@salesforce/schema/Lead.Engagement_Score__c";
import MODEL from "@salesforce/schema/Lead.Model_Interest__c";
import BUDGET from "@salesforce/schema/Lead.Budget_Range__c";
import TIMEFRAME from "@salesforce/schema/Lead.Purchase_Timeframe__c";
import TESTDRIVE from "@salesforce/schema/Lead.Test_Drive_Status__c";

const R = 52;
const CIRC = 2 * Math.PI * R;

const TIME_PTS = {
  "Immediate (0-15 days)": 25,
  "Within 1 Month": 20,
  "1-3 Months": 15,
  "3-6 Months": 8,
  "Just Exploring": 3
};
const TD_PTS = {
  Completed: 30,
  Scheduled: 22,
  "Follow-up Needed": 12,
  "Not Scheduled": 4
};

export default class De_veloLeadScore extends LightningElement {
  @api recordId;
  lead;

  @wire(getRecord, { recordId: "$recordId", fields: [SCORE, MODEL, BUDGET, TIMEFRAME, TESTDRIVE] })
  wired({ data }) {
    if (data) this.lead = data;
  }

  v(f) { return getFieldValue(this.lead, f); }

  get factors() {
    return [
      { id: "model", label: "Model Interest", pts: this.v(MODEL) ? 25 : 0, max: 25 },
      { id: "budget", label: "Budget Provided", pts: this.v(BUDGET) ? 20 : 0, max: 20 },
      { id: "time", label: "Purchase Urgency", pts: TIME_PTS[this.v(TIMEFRAME)] || 0, max: 25 },
      { id: "td", label: "Test Drive", pts: TD_PTS[this.v(TESTDRIVE)] || 0, max: 30 }
    ];
  }

  get computed() {
    return this.factors.reduce((s, f) => s + f.pts, 0);
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
    if (b === "Hot") return "band band--hot";
    if (b === "Warm") return "band band--warm";
    return "band band--cold";
  }
  get ringColor() {
    const b = this.band;
    if (b === "Hot") return "#e11b22";
    if (b === "Warm") return "#f5a623";
    return "#5ac8fa";
  }

  get circ() { return CIRC; }
  get dashOffset() { return CIRC * (1 - this.score / 100); }

  get factorRows() {
    return this.factors.map((f) => ({
      ...f,
      pct: Math.round((f.pts / f.max) * 100),
      style: `width:${Math.round((f.pts / f.max) * 100)}%`,
      fillClass: f.pts === 0 ? "fb__fill fb__fill--empty" : "fb__fill"
    }));
  }

  get summaryLine() {
    const b = this.band;
    if (b === "Hot") return "High-intent buyer — prioritise immediate follow-up.";
    if (b === "Warm") return "Engaged prospect — nurture toward a test drive.";
    return "Early-stage — qualify interest and budget.";
  }
}