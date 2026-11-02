import { LightningElement, api, wire } from "lwc";
import getCalls from "@salesforce/apex/de_VeloVoiceCallController.getCalls";
import getTranscript from "@salesforce/apex/de_VeloVoiceCallController.getTranscript";

// Fixed waveform silhouette — the "played" portion tracks REAL audio progress.
const WAVE = [
  8, 14, 22, 30, 18, 12, 26, 34, 40, 28, 16, 10, 20, 32, 44, 38, 24, 14, 9,
  18, 30, 42, 36, 22, 12, 8, 16, 28, 38, 30, 20, 12, 24, 34, 26, 14, 10, 18,
  28, 36, 30, 20, 12, 8, 15, 25, 33, 27
];

// Dummy insights (rotated by position) until real AI analysis is wired in.
const DUMMY_INSIGHTS = [
  {
    title: "Velo Orion X7 — Enquiry Follow-up",
    sentiment: "Positive",
    intent: "High Purchase Intent",
    summary:
      "AI assistant confirmed interest in the Velo Orion X7. Customer preferred the diesel automatic (Summit L) and asked about the on-road price in Pune and current waiting period. Expressed intent to visit the showroom this weekend for a test drive.",
    highlights: [
      "Confirmed model: Velo Orion X7 Summit L (Diesel, AT)",
      "Asked about on-road price + waiting period",
      "Open to a weekend test drive",
      "Budget signals aligned to Rs 20L - 30L"
    ],
    nextAction: "Schedule weekend test drive & share on-road quote"
  },
  {
    title: "Finance & EMI Options",
    sentiment: "Neutral",
    intent: "Evaluating Options",
    summary:
      "Customer wanted to understand financing options. AI explained EMI plans and the exchange bonus on the current vehicle, and noted a request to compare a 5-year vs 7-year tenure with a finance specialist.",
    highlights: [
      "Interested in Loan / EMI (not cash)",
      "Comparing 5-yr vs 7-yr tenure",
      "Mentioned exchange of existing Trekker",
      "Requested finance specialist callback"
    ],
    nextAction: "Arrange finance specialist callback with EMI comparison"
  },
  {
    title: "Initial Qualification Call",
    sentiment: "Positive",
    intent: "Qualified",
    summary:
      "First-touch qualification after a web enquiry. AI captured model interest, city and rough budget. Customer is an SUV enthusiast upgrading from a hatchback and prioritises off-road capability and safety rating.",
    highlights: [
      "First touch after website enquiry",
      "Prioritises off-road capability + 5-star safety",
      "Upgrading from a hatchback",
      "Located in Pune"
    ],
    nextAction: "Send Velo Orion X7 brochure + safety highlights"
  }
];

const AGENT = "Velo AI Voice Assistant";

export default class De_veloAiCallHistory extends LightningElement {
  @api recordId;

  calls = [];
  activeId;
  error;

  // transcript state (fetched live, per call)
  txById = {};        // callId -> [{speaker,t,text}]
  txLoadingId;        // callId currently being fetched
  txErrorById = {};   // callId -> error message

  // audio state (real playback)
  isPlaying = false;
  currentTime = 0;
  audioDuration = 0;

  @wire(getCalls, { recordId: "$recordId" })
  wired({ data, error }) {
    if (data) {
      this.calls = data.map((c, i) => this.decorate(c, i));
      if (this.calls.length && !this.calls.some((c) => c.id === this.activeId)) {
        this.activeId = this.calls[0].id; // latest (query is DESC)
      }
      this.error = undefined;
      // pull the real transcript for the call shown by default
      if (this.activeId) this.loadTranscript(this.activeId);
    } else if (error) {
      this.error = error;
      this.calls = [];
    }
  }

  // Fetch the actual conversation transcript live for one call and cache it by
  // id so switching back is instant and we never re-fetch the same call.
  loadTranscript(id) {
    if (!id || this.txById[id] || this.txErrorById[id] || this.txLoadingId === id) {
      return; // already have it, failed before, or in flight
    }
    this.txLoadingId = id;
    getTranscript({ voiceCallId: id })
      .then((turns) => {
        // reassign the map so the getters re-run reactively
        this.txById = { ...this.txById, [id]: turns || [] };
      })
      .catch((e) => {
        const msg = (e && e.body && e.body.message) || "Unable to load transcript.";
        this.txErrorById = { ...this.txErrorById, [id]: msg };
      })
      .finally(() => {
        if (this.txLoadingId === id) this.txLoadingId = undefined;
      });
  }

  // merge real VoiceCall metadata + real recording audio + real transcript
  // with the (still dummy) AI insights
  decorate(c, i) {
    const insight = DUMMY_INSIGHTS[i % DUMMY_INSIGHTS.length];
    // AI voice assistant places outbound calls to the customer, so present the
    // conversation as Outbound. (VoiceCall.CallType is read-only in this org.)
    return {
      id: c.id,
      name: c.name,
      direction: "Outbound",
      agent: AGENT,
      dateLabel: this.formatDate(c.startTime),
      duration: this.formatDur(c.durationSeconds),
      isRecorded: c.isRecorded,
      // real call recording streamed from the linked File (null if none)
      audioUrl: c.recordingUrl,
      hasAudio: !!c.recordingUrl,
      ...insight
    };
  }

  formatDur(secs) {
    const s = Number(secs) || 0;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  formatDate(dt) {
    if (!dt) return "—";
    const d = new Date(dt);
    const now = new Date();
    const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (sameDay) return `Today, ${time}`;
    if (d.toDateString() === yest.toDateString()) return `Yesterday, ${time}`;
    const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return `${day}, ${time}`;
  }

  get hasCalls() { return this.calls.length > 0; }
  get callCount() { return this.calls.length; }

  get active() {
    return this.calls.find((c) => c.id === this.activeId) || this.calls[0] || {};
  }

  get audioSrc() { return this.active.audioUrl; }

  // rows for the currently selected call, fetched live and cached by id
  get activeTurns() { return this.txById[this.activeId] || []; }

  get transcript() {
    return this.activeTurns.map((r, i) => {
      const isAgent = r.speaker === "Agent" || r.speaker === "Bot";
      return {
        key: i,
        speaker: isAgent ? "AI Assistant" : "Customer",
        time: r.t,
        text: r.text,
        rowClass: isAgent ? "tr tr--agent" : "tr tr--cust",
        avatarClass: isAgent ? "tr__av tr__av--agent" : "tr__av tr__av--cust",
        avatarIcon: isAgent ? "utility:einstein" : "utility:user"
      };
    });
  }

  get hasTranscript() { return this.activeTurns.length > 0; }
  get transcriptLoading() { return this.txLoadingId === this.activeId; }
  get transcriptError() { return this.txErrorById[this.activeId]; }
  // show the transcript panel whenever there's something to say about it
  get showTranscript() {
    return this.hasTranscript || this.transcriptLoading || !!this.transcriptError;
  }

  get bars() {
    const frac = this.audioDuration > 0 ? this.currentTime / this.audioDuration : 0;
    const mid = Math.floor(WAVE.length * frac);
    return WAVE.map((h, i) => ({
      key: i,
      style: `height:${h}px`,
      className: i <= mid ? "bar bar--played" : "bar"
    }));
  }

  get playIcon() { return this.isPlaying ? "utility:pause" : "utility:play"; }

  // shows elapsed / total while playing, otherwise the call's recorded duration
  get timeLabel() {
    if (this.isPlaying || this.currentTime > 0) {
      return `${this.formatDur(Math.floor(this.currentTime))} / ${this.formatDur(Math.floor(this.audioDuration))}`;
    }
    return this.active.duration;
  }

  get sentimentClass() {
    const s = this.active.sentiment;
    if (s === "Positive") return "m-pill is-pos";
    if (s === "Negative") return "m-pill is-neg";
    return "m-pill is-warn";
  }

  get list() {
    return this.calls.map((c) => ({
      ...c,
      rowClass: c.id === this.activeId ? "row row--active" : "row",
      dirClass: c.direction === "Inbound" ? "dir dir--in" : "dir dir--out",
      dirIcon: c.direction === "Inbound" ? "utility:call_incoming" : "utility:outbound_call"
    }));
  }

  // ---------- interactions ----------
  selectCall(evt) {
    const id = evt.currentTarget.dataset.id;
    if (id === this.activeId) return;
    this.stopAudio();
    // reset per-call playback state so the player + waveform reflect the new
    // call immediately (real duration re-arrives via onloadedmetadata).
    this.audioDuration = 0;
    this.activeId = id;
    // src is bound to audioSrc; force the media element to load the new file
    // once the re-render has swapped the attribute.
    this._reloadAudio = true;
    // fetch the real transcript for this call (cached after the first time)
    this.loadTranscript(id);
  }

  renderedCallback() {
    if (this._reloadAudio) {
      this._reloadAudio = false;
      const el = this.audioEl;
      if (el) el.load();
    }
  }

  get audioEl() { return this.template.querySelector("audio"); }

  togglePlay() {
    const el = this.audioEl;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => { this.isPlaying = true; }).catch(() => { this.isPlaying = false; });
    } else {
      el.pause();
      this.isPlaying = false;
    }
  }

  stopAudio() {
    const el = this.audioEl;
    if (el) { el.pause(); el.currentTime = 0; }
    this.isPlaying = false;
    this.currentTime = 0;
  }

  handleTime(evt) { this.currentTime = evt.target.currentTime; }
  handleMeta(evt) { this.audioDuration = evt.target.duration || 0; }
  handleEnded() { this.isPlaying = false; this.currentTime = 0; }

  // click the waveform to seek
  handleSeek(evt) {
    const el = this.audioEl;
    if (!el || !this.audioDuration) return;
    const rect = evt.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
    el.currentTime = frac * this.audioDuration;
    this.currentTime = el.currentTime;
  }
}
