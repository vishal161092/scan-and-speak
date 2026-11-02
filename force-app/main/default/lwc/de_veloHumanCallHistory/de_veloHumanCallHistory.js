import { LightningElement, api } from "lwc";

// Placeholder UI data — real recordings/transcripts wired in later.
const WAVE = [
  10, 18, 26, 20, 12, 24, 32, 40, 30, 18, 12, 22, 34, 42, 30, 20, 12, 8, 16,
  28, 38, 30, 22, 14, 10, 20, 30, 40, 34, 24, 14, 9, 17, 27, 37, 29, 19, 11,
  21, 31, 39, 33, 23, 13, 9, 15, 25, 35
];

const CALLS = [
  {
    id: "h1",
    title: "Test Drive Coordination",
    advisor: "Dev Mehta",
    role: "Senior Sales Advisor",
    direction: "Outbound",
    date: "Today, 2:10 PM",
    duration: "6:20",
    sentiment: "Positive",
    score: 84,
    summary:
      "Advisor called to lock a test-drive slot for the Velo Orion X7. Customer preferred Saturday morning at the Kothrud showroom and asked for a diesel AT unit. Advisor confirmed availability and offered a home test drive as an alternative.",
    transcript: [
      { id: 1, who: "advisor", name: "Dev", text: "Hi Mr. Sharma, Dev from Velo Kothrud. Thanks for your interest in the Velo Orion X7! Is now a good time?", tone: "pos" },
      { id: 2, who: "customer", name: "Customer", text: "Yes, go ahead. I wanted to actually feel the diesel automatic before deciding.", tone: "neu" },
      { id: 3, who: "advisor", name: "Dev", text: "Absolutely. We have the Summit L diesel AT available this Saturday morning. Shall I block 11 AM for you?", tone: "pos" },
      { id: 4, who: "customer", name: "Customer", text: "Saturday 11 works. Can you also keep the crimson colour ready?", tone: "pos" },
      { id: 5, who: "advisor", name: "Dev", text: "Done. I'll also share the on-road price and exchange value for your Trekker before then.", tone: "pos" }
    ]
  },
  {
    id: "h2",
    title: "Price & Exchange Discussion",
    advisor: "Priya Nair",
    role: "Sales Consultant",
    direction: "Inbound",
    date: "Yesterday, 5:30 PM",
    duration: "8:45",
    sentiment: "Mixed",
    score: 58,
    summary:
      "Customer called about pricing and felt the on-road quote was slightly above budget. Some concern about the waiting period. Advisor offered an exchange bonus and a corporate discount to bridge the gap.",
    transcript: [
      { id: 1, who: "customer", name: "Customer", text: "The on-road price is a bit higher than I expected, honestly.", tone: "neg" },
      { id: 2, who: "advisor", name: "Priya", text: "I understand. With the exchange bonus on your Trekker and the corporate offer, we can bring it closer to your budget.", tone: "pos" },
      { id: 3, who: "customer", name: "Customer", text: "And what about the waiting period? I've heard it's long.", tone: "neu" },
      { id: 4, who: "advisor", name: "Priya", text: "For the Summit L diesel AT it's about 6 weeks currently. I can check for an earlier allotment.", tone: "neu" },
      { id: 5, who: "customer", name: "Customer", text: "Okay, please check and let me know the best final number.", tone: "neu" }
    ]
  }
];

export default class De_veloHumanCallHistory extends LightningElement {
  @api recordId;
  calls = CALLS;
  activeId = "h1";
  playing = false;
  tab = "transcript";

  get active() {
    return this.calls.find((c) => c.id === this.activeId) || this.calls[0];
  }
  get bars() {
    const mid = this.playing ? Math.floor(WAVE.length * 0.5) : -1;
    return WAVE.map((h, i) => ({
      key: i,
      style: `height:${h}px`,
      className: i <= mid ? "bar bar--played" : "bar"
    }));
  }
  get playIcon() { return this.playing ? "utility:pause" : "utility:play"; }

  get initials() {
    return this.active.advisor.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  }

  get sentimentClass() {
    const s = this.active.sentiment;
    if (s === "Positive") return "m-pill is-pos";
    if (s === "Negative") return "m-pill is-neg";
    return "m-pill is-warn";
  }
  get scoreStyle() { return `width:${this.active.score}%`; }
  get scoreColorClass() {
    const v = this.active.score;
    if (v >= 70) return "meter__fill meter__fill--pos";
    if (v >= 45) return "meter__fill meter__fill--warn";
    return "meter__fill meter__fill--neg";
  }

  get showTranscript() { return this.tab === "transcript"; }
  get showSummary() { return this.tab === "summary"; }
  get transcriptTabClass() { return this.tab === "transcript" ? "tab tab--on" : "tab"; }
  get summaryTabClass() { return this.tab === "summary" ? "tab tab--on" : "tab"; }

  get turns() {
    return this.active.transcript.map((t) => ({
      ...t,
      rowClass: t.who === "advisor" ? "turn turn--advisor" : "turn turn--customer",
      bubbleClass: `bubble bubble--${t.tone}`
    }));
  }

  get list() {
    return this.calls.map((c) => ({
      ...c,
      rowClass: c.id === this.activeId ? "row row--active" : "row",
      dirIcon: c.direction === "Inbound" ? "utility:call_incoming" : "utility:outbound_call"
    }));
  }
  get callCount() { return this.calls.length; }

  selectCall(evt) {
    this.activeId = evt.currentTarget.dataset.id;
    this.playing = false;
  }
  togglePlay() { this.playing = !this.playing; }
  showTranscriptTab() { this.tab = "transcript"; }
  showSummaryTab() { this.tab = "summary"; }
}