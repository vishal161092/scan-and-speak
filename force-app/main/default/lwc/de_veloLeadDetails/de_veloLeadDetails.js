import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue } from "lightning/uiRecordApi";

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
import SOURCE from "@salesforce/schema/Lead.LeadSource";

// Edit fields with our OWN labels — native lightning-input-field labels are
// hidden (variant="label-hidden") and re-rendered here so they stay white on
// the dark editing surface regardless of org theme / base-component shadow DOM.
const EDIT_FIELDS = [
  { name: MODEL.fieldApiName, label: "Model Interest" },
  { name: VARIANT.fieldApiName, label: "Variant" },
  { name: FUEL.fieldApiName, label: "Fuel Preference" },
  { name: TRANS.fieldApiName, label: "Transmission Preference" },
  { name: BUDGET.fieldApiName, label: "Budget Range" },
  { name: TIMEFRAME.fieldApiName, label: "Purchase Timeframe" },
  { name: TESTDRIVE.fieldApiName, label: "Test Drive Status" },
  { name: FINANCE.fieldApiName, label: "Financing Interest" },
  { name: TRADEIN.fieldApiName, label: "Trade-In Vehicle" },
  { name: DEALER.fieldApiName, label: "Preferred Dealership" }
];

export default class De_veloLeadDetails extends LightningElement {
  @api recordId;
  objectApiName = "Lead";
  lead;
  editing = false;
  editFields = EDIT_FIELDS;

  @wire(getRecord, {
    recordId: "$recordId",
    fields: [MODEL, VARIANT, FUEL, TRANS, BUDGET, TIMEFRAME, TESTDRIVE, TRADEIN, FINANCE, DEALER, SOURCE]
  })
  wired({ data }) {
    if (data) this.lead = data;
  }

  v(field) { return getFieldValue(this.lead, field); }

  get model() { return this.v(MODEL) || "Not captured"; }
  get hasModel() { return !!this.v(MODEL); }
  get variant() { return this.v(VARIANT) || "—"; }
  get fuel() { return this.v(FUEL) || "—"; }
  get transmission() { return this.v(TRANS) || "—"; }

  get vehicleSub() {
    const parts = [this.v(VARIANT), this.v(FUEL), this.v(TRANS)].filter(Boolean);
    return parts.length ? parts.join("  ·  ") : "Awaiting discovery";
  }

  get qualRows() {
    return [
      { id: "budget", label: "Budget Range", value: this.v(BUDGET) || "—", icon: "utility:moneybag" },
      { id: "time", label: "Purchase Timeframe", value: this.v(TIMEFRAME) || "—", icon: "utility:date_input" },
      { id: "finance", label: "Financing", value: this.v(FINANCE) || "—", icon: "utility:currency" },
      { id: "trade", label: "Trade-In Vehicle", value: this.v(TRADEIN) || "—", icon: "utility:cases" },
      { id: "dealer", label: "Preferred Dealership", value: this.v(DEALER) || "—", icon: "utility:company" },
      { id: "source", label: "Lead Source", value: this.v(SOURCE) || "—", icon: "utility:broadcast" }
    ];
  }

  get testDrive() { return this.v(TESTDRIVE) || "Not Scheduled"; }
  get testDriveClass() {
    const s = this.v(TESTDRIVE);
    if (s === "Completed") return "m-pill is-pos";
    if (s === "Scheduled") return "m-pill is-accent";
    if (s === "Follow-up Needed") return "m-pill is-warn";
    return "m-pill";
  }

  get editLabel() { return this.editing ? "Close" : "Edit"; }

  toggleEdit() { this.editing = !this.editing; }
  handleSuccess() { this.editing = false; }
  handleCancel() { this.editing = false; }
}