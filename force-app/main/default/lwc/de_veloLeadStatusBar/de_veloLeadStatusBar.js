import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue, updateRecord } from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import ID_FIELD from "@salesforce/schema/Lead.Id";
import STATUS from "@salesforce/schema/Lead.Status";
import CONVERTED from "@salesforce/schema/Lead.IsConverted";
import CREATED from "@salesforce/schema/Lead.CreatedDate";
import ACTIVITY from "@salesforce/schema/Lead.LastActivityDate";

const PATH = ["New", "Working", "Qualified", "Converted"];

export default class De_veloLeadStatusBar extends LightningElement {
  @api recordId;
  lead;
  saving = false;

  @wire(getRecord, { recordId: "$recordId", fields: [STATUS, CONVERTED, CREATED, ACTIVITY] })
  wired({ data }) {
    if (data) this.lead = data;
  }

  get status() { return getFieldValue(this.lead, STATUS) || "New"; }
  get isLost() { return this.status === "Unqualified"; }
  get isConverted() {
    return getFieldValue(this.lead, CONVERTED) || this.status === "Converted";
  }

  get currentIndex() {
    const i = PATH.indexOf(this.status);
    return i === -1 ? 0 : i;
  }

  get steps() {
    const cur = this.currentIndex;
    return PATH.map((label, i) => {
      let state = "future";
      if (i < cur) state = "done";
      else if (i === cur) state = "current";
      return {
        label,
        value: label,
        num: i + 1,
        isDone: state === "done",
        isCurrent: state === "current",
        className: `step step--${state}`,
        connectorClass: i < cur ? "connector connector--done" : "connector"
      };
    });
  }

  // pipeline progress — mirrors the 360 card's gradient bar
  get progressPct() {
    if (this.isLost) return 100;
    const last = PATH.length - 1;
    return Math.round((this.currentIndex / last) * 100);
  }
  get progressStyle() { return `width:${this.progressPct}%`; }
  get progressFillClass() {
    if (this.isConverted) return "sb__fill sb__fill--pos";
    if (this.isLost) return "sb__fill sb__fill--neg";
    return "sb__fill sb__fill--accent";
  }
  get stageLabel() {
    if (this.isConverted) return "Deal won";
    if (this.isLost) return "Pipeline closed";
    return `Stage ${this.currentIndex + 1} of ${PATH.length}`;
  }

  get headline() {
    if (this.isConverted) return "Converted — Deal Won";
    if (this.isLost) return "Unqualified";
    return this.status;
  }
  get headlineClass() {
    if (this.isConverted) return "headline is-pos";
    if (this.isLost) return "headline is-neg";
    return "headline";
  }

  get ageLabel() {
    const c = getFieldValue(this.lead, CREATED);
    if (!c) return "—";
    const days = Math.max(0, Math.floor((Date.now() - new Date(c).getTime()) / 86400000));
    return days === 0 ? "Today" : `${days}d in pipeline`;
  }
  get lastActivity() {
    const a = getFieldValue(this.lead, ACTIVITY);
    return a ? new Date(a).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "No activity";
  }

  handleStep(evt) {
    const value = evt.currentTarget.dataset.value;
    if (this.saving || value === this.status) return;
    this.saving = true;
    const fields = { [ID_FIELD.fieldApiName]: this.recordId, [STATUS.fieldApiName]: value };
    updateRecord({ fields })
      .then(() => {
        this.dispatchEvent(
          new ShowToastEvent({ title: "Status updated", message: `Lead moved to ${value}`, variant: "success" })
        );
      })
      .catch((e) => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Could not update status",
            message: (e && e.body && e.body.message) || "Error",
            variant: "error"
          })
        );
      })
      .finally(() => { this.saving = false; });
  }
}