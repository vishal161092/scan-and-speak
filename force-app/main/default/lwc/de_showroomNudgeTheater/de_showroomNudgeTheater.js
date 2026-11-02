import { LightningElement, track } from 'lwc';
import getNudge from '@salesforce/apex/de_ShowroomNudgeService.getNudge';
import getLatestNudge from '@salesforce/apex/de_ShowroomNudgeService.getLatestNudge';

/**
 * Showroom Nudge Theater — a live, premium visualisation of the "AI in the loop"
 * that turns showroom conversation into proactive sales nudges.
 *
 * Two modes share ONE pipeline visualisation + device delivery:
 *
 *   • "Go live"  — the real shared run. The Customer 360 web app listens to the mic,
 *     calls the Showroom_Nudge_Flex prompt every ~10s and writes the result to a
 *     Nudge__c record. This theater polls that record every 2s (getLatestNudge) and,
 *     on each new nudge, replays how Agentforce reached it and drops the nudge on the
 *     rep's phone & watch. Talk into the web mic → it surfaces here.
 *
 *   • "Rehearse" — a self-contained scripted run that calls the SAME prompt live
 *     (getNudge) for a fixed conversation. Useful with no mic / no network.
 */

const STEP_DEFS = [
    { key: 'transcribe', title: 'Transcript', desc: 'Audio → text', icon: 'utility:unmuted' },
    { key: 'understand', title: 'Understand', desc: 'Prompt in Salesforce', icon: 'utility:einstein' },
    { key: 'signals', title: 'Signals', desc: 'Phase & cues', icon: 'utility:broadcast' },
    { key: 'generate', title: 'Generate', desc: 'Card + watch line', icon: 'utility:magicwand' },
    { key: 'deliver', title: 'Deliver', desc: 'To phone & watch', icon: 'utility:phone_portrait' }
];

// Fixed demo session — matches SF_NUDGE_SESSION_ID in the Customer 360 web app.
const SESSION_ID = 'Demo-001';
const POLL_MS = 2000;

// Scripted rehearsal conversation. Each line is sent verbatim to the real prompt.
const CONVO = [
    { speaker: 'Customer', line: 'Honestly my first question is just — how safe is it for my kids?' },
    { speaker: 'Customer', line: 'Wow, and the kids will absolutely love that huge sunroof.' },
    { speaker: 'Customer', line: 'I was also looking at the Arden Trailblazer, to be fair it looked nice.' },
    { speaker: 'Customer', line: 'Are there any festive offers running right now?' },
    { speaker: 'Customer', line: 'And what would the monthly EMI look like if I finance it?' }
];

const PHASE_LABELS = {
    greeting: 'Greeting',
    discovery: 'Discovery',
    needs: 'Needs',
    features: 'Features',
    competition: 'Competition',
    offers: 'Offers',
    pricing: 'Pricing',
    financing: 'Finance',
    pricing_financing: 'Finance',
    objection: 'Objection',
    closing: 'Closing'
};

export default class ShowroomNudgeTheater extends LightningElement {
    @track steps = STEP_DEFS.map((s) => ({ ...s, state: 'idle' }));
    @track transcript = [];
    @track deliveredCards = [];

    @track detectedPhase = '';
    @track detectedTopic = '';
    @track reasoning = '';
    @track draftLong = '';
    @track draftShort = '';

    @track phoneCategory = '';
    @track phoneText = '';
    @track watchText = '';
    @track watchCategory = '';

    // scripted rehearsal state
    running = false;
    finished = false;

    // live-listen state
    @track listening = false;
    _pollTimer = null;
    _lastSig = null;      // last Nudge__c signature we reacted to
    _primed = false;      // ignore the record that already exists when we go live
    _busy = false;        // a replay animation is in flight
    _lastDeliveredLong = ''; // avoid re-delivering an unchanged nudge to the devices

    watchBuzz = false;
    phoneShow = false;
    _timers = [];
    _cardSeq = 0;

    // rolling context threaded between scripted turns (mirrors the web pipeline)
    _rollingSummary = '';
    _currentPhase = '';
    _lastNudgeText = '';

    // ----- lifecycle -----
    disconnectedCallback() {
        this._stopPolling();
        this._clearTimers();
    }

    // ----- getters for template -----
    get computedSteps() {
        const last = this.steps.length - 1;
        return this.steps.map((s, i) => {
            const isDone = s.state === 'done';
            const isActive = s.state === 'active';
            return {
                ...s,
                isDone,
                isActive,
                nodeCls: 'node' + (isDone ? ' node--done' : isActive ? ' node--active' : ''),
                nameCls: 'step-name' + (isDone || isActive ? '' : ' step-name--muted'),
                showConnector: i < last,
                connectorCls: 'connector' + (isDone ? ' connector--done' : '')
            };
        });
    }

    get goLiveLabel() {
        return this.listening ? 'Stop listening' : 'Go live';
    }

    get goLiveClass() {
        return this.listening ? 'start start--stop' : 'start';
    }

    get goLiveDisabled() {
        return this.running;
    }

    get rehearseLabel() {
        if (this.running) return 'Running…';
        return this.finished ? 'Replay rehearsal' : 'Rehearse (scripted)';
    }

    get rehearseDisabled() {
        return this.running || this.listening;
    }

    get liveClass() {
        return this.running || this.listening ? 'live live--on' : 'live';
    }

    get liveText() {
        return this.listening ? 'Listening' : 'Live';
    }

    get phoneClass() {
        return this.phoneShow ? 'nudge-card nudge-card--in' : 'nudge-card nudge-card--hidden';
    }

    get watchClass() {
        return this.watchBuzz ? 'watch-face watch-face--buzz' : 'watch-face';
    }

    get hasPhoneNudge() {
        return !!this.phoneText;
    }

    // =====================================================================
    // LIVE MODE — mirror the Customer 360 web mic session
    // =====================================================================
    handleGoLive() {
        if (this.running) return;
        if (this.listening) {
            this._stopPolling();
            this.listening = false;
            this._idleSteps();
            this.reasoning = '';
            return;
        }
        this._reset();
        this.listening = true;
        this._primed = false;
        this._lastSig = null;
        this._lastDeliveredLong = '';
        this.reasoning = 'Connected. Listening to the live showroom conversation…';
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._pollTimer = setInterval(() => this._poll(), POLL_MS);
        this._poll();
    }

    async _poll() {
        if (!this.listening || this._busy) return;
        let nudge;
        try {
            nudge = await getLatestNudge({ sessionId: SESSION_ID });
        } catch (e) {
            // transient — keep listening, keep the last state on screen
            return;
        }
        if (!this.listening || !nudge || !nudge.signature) return;

        // On the first poll, adopt the current record as baseline so we only
        // react to nudges generated AFTER the user pressed "Go live".
        if (!this._primed) {
            this._primed = true;
            this._lastSig = nudge.signature;
            return;
        }
        if (nudge.signature === this._lastSig) return;

        this._lastSig = nudge.signature;
        await this._playLive(nudge);
    }

    async _playLive(nudge) {
        this._busy = true;

        // A fresh turn is starting to process — now clear the previous reasoning.
        this.reasoning = 'New line detected — sending to Agentforce…';
        this.detectedPhase = '';
        this.detectedTopic = '';
        this.draftLong = '';
        this.draftShort = '';

        // 1. transcript chunk that triggered the nudge
        this._setStep('transcribe', 'active');
        if (nudge.transcript) {
            this._pushTranscript('Customer', nudge.transcript);
        }
        await this._wait(1100);
        this._setStep('transcribe', 'done');

        // 2. prompt in Salesforce already ran on the web side — visualise it
        this._setStep('understand', 'active');
        this.reasoning = 'Agentforce is processing this turn with the Showroom prompt…';
        await this._wait(1300);
        this._setStep('understand', 'done');

        // 3. signals — real phase / topic + the model's running summary
        this._setStep('signals', 'active');
        this.detectedPhase = PHASE_LABELS[(nudge.phase || '').toLowerCase()] || nudge.phase || '';
        this.detectedTopic = nudge.topic || '';
        this.reasoning = nudge.rollingSummary || 'Grounding on model specs and intent…';
        await this._wait(1400);
        this._setStep('signals', 'done');

        // 4. generate — typewriter on the real longNudge
        this._setStep('generate', 'active');
        this.draftShort = nudge.shortNudge || '';
        if (nudge.longNudge) {
            await this._typewrite(nudge.longNudge);
        }
        await this._wait(700);
        this._setStep('generate', 'done');

        // 5. deliver — push to phone & watch when the nudge text actually changed
        this._setStep('deliver', 'active');
        if (nudge.longNudge && nudge.longNudge !== this._lastDeliveredLong) {
            this._lastDeliveredLong = nudge.longNudge;
            this._deliver(nudge);
            await this._wait(1500);
        } else {
            await this._wait(600);
        }
        this._setStep('deliver', 'done');

        await this._wait(800);
        this._idleTurn();
        this._busy = false;
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this._busy = false;
    }

    // =====================================================================
    // REHEARSAL MODE — scripted conversation through the real prompt
    // =====================================================================
    async handleStart() {
        if (this.running || this.listening) return;
        this._reset();
        this.running = true;
        this.finished = false;

        for (let i = 0; i < CONVO.length; i++) {
            /* eslint-disable no-await-in-loop */
            await this._processTurn(CONVO[i]);
            await this._wait(700);
        }

        this._idleSteps();
        this.running = false;
        this.finished = true;
    }

    async _processTurn(turn) {
        // A fresh turn is starting to process — now clear the previous reasoning.
        this.reasoning = 'New line detected — sending to Agentforce…';
        this.detectedPhase = '';
        this.detectedTopic = '';
        this.draftLong = '';
        this.draftShort = '';

        // 1. transcript chunk received
        this._setStep('transcribe', 'active');
        this._pushTranscript(turn.speaker, turn.line);
        await this._wait(1100);
        this._setStep('transcribe', 'done');

        // 2. hand the chunk + rolling context to the real prompt template
        this._setStep('understand', 'active');
        this.reasoning = 'Sending the conversation to Agentforce…';

        let nudge;
        try {
            nudge = await getNudge({
                latestTranscript: turn.line,
                rollingSummary: this._rollingSummary,
                currentPhase: this._currentPhase,
                lastNudgeText: this._lastNudgeText
            });
        } catch (e) {
            this.reasoning = 'Agentforce could not generate a nudge for this turn (' +
                this._errText(e) + ').';
            this._setStep('understand', 'done');
            await this._wait(900);
            this._idleTurn();
            return;
        }
        this._setStep('understand', 'done');

        // 3. meaningful signals — real phase/topic + the model's running summary
        this._setStep('signals', 'active');
        this.detectedPhase = PHASE_LABELS[(nudge.phase || '').toLowerCase()] || nudge.phase || '';
        this.detectedTopic = nudge.topic || '';
        this.reasoning = nudge.rollingSummary || 'Analysing intent and grounding on model specs…';
        await this._wait(1400);
        this._setStep('signals', 'done');

        // carry rolling context forward for the next turn
        this._rollingSummary = nudge.rollingSummary || this._rollingSummary;
        this._currentPhase = nudge.phase || this._currentPhase;

        // 4. generating the nudge (typewriter feel on the real longNudge)
        this._setStep('generate', 'active');
        this.draftShort = nudge.shortNudge || '';
        if (nudge.longNudge) {
            await this._typewrite(nudge.longNudge);
        }
        await this._wait(700);
        this._setStep('generate', 'done');

        // 5. deliver to devices — only when the model marks it as a materially new nudge
        this._setStep('deliver', 'active');
        if (nudge.longNudge && nudge.isNew !== false) {
            this._lastNudgeText = nudge.longNudge;
            this._deliver(nudge);
            await this._wait(1500);
        } else {
            await this._wait(600);
        }
        this._setStep('deliver', 'done');

        await this._wait(800);
        this._idleTurn();
    }

    // =====================================================================
    // SHARED — delivery + helpers
    // =====================================================================

    // reset only the pipeline steps between turns. The full reasoning panel —
    // analysis + phase/topic chips + the drafting-nudge block — PERSISTS on screen
    // until the next turn starts processing, so the audience keeps the full context.
    _idleTurn() {
        this._idleSteps();
    }

    _deliver(nudge) {
        const category = this._categoryFor(nudge);

        // phone card
        this.phoneShow = false;
        this.phoneCategory = category;
        this.phoneText = nudge.longNudge;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        const t = setTimeout(() => {
            this.phoneShow = true;
        }, 60);
        this._timers.push(t);

        // watch buzz
        this.watchCategory = category;
        this.watchText = nudge.shortNudge || nudge.topic || 'New nudge';
        this.watchBuzz = false;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        const t2 = setTimeout(() => {
            this.watchBuzz = true;
        }, 80);
        this._timers.push(t2);

        // transient nudge card that appears then disappears
        this._addCard(nudge, category);
    }

    _categoryFor(nudge) {
        if (nudge.topic) return nudge.topic;
        return PHASE_LABELS[(nudge.phase || '').toLowerCase()] || nudge.phase || 'Nudge';
    }

    _addCard(nudge, category) {
        const id = ++this._cardSeq;
        const card = {
            id,
            category,
            shortNudge: nudge.shortNudge || nudge.topic || '',
            longNudge: nudge.longNudge,
            cls: 'feed-card feed-card--in'
        };
        this.deliveredCards = [card, ...this.deliveredCards].slice(0, 4);

        // fade out after a while
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        const tOut = setTimeout(() => {
            this.deliveredCards = this.deliveredCards.map((c) =>
                c.id === id ? { ...c, cls: 'feed-card feed-card--out' } : c
            );
        }, 5200);
        this._timers.push(tOut);

        // eslint-disable-next-line @lwc/lwc/no-async-operation
        const tRemove = setTimeout(() => {
            this.deliveredCards = this.deliveredCards.filter((c) => c.id !== id);
        }, 6000);
        this._timers.push(tRemove);
    }

    _errText(e) {
        return (e && e.body && e.body.message) || (e && e.message) || 'unavailable';
    }

    _pushTranscript(speaker, text) {
        const id = 'ln-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
        const isCustomer = speaker === 'Customer';
        const line = {
            id,
            speaker,
            text,
            cls: 'line ' + (isCustomer ? 'line--customer' : 'line--rep')
        };
        this.transcript = [line, ...this.transcript].slice(0, 6);
    }

    _setStep(key, state) {
        this.steps = this.steps.map((s) => (s.key === key ? { ...s, state } : s));
    }

    _idleSteps() {
        this.steps = this.steps.map((s) => ({ ...s, state: 'idle' }));
    }

    async _typewrite(full) {
        const words = full.split(' ');
        let acc = '';
        for (let i = 0; i < words.length; i++) {
            acc += (i ? ' ' : '') + words[i];
            this.draftLong = acc;
            /* eslint-disable no-await-in-loop */
            await this._wait(38);
        }
    }

    _wait(ms) {
        return new Promise((resolve) => {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            const t = setTimeout(resolve, ms);
            this._timers.push(t);
        });
    }

    _clearTimers() {
        this._timers.forEach((t) => clearTimeout(t));
        this._timers = [];
    }

    _reset() {
        this._clearTimers();
        this._idleSteps();
        this.transcript = [];
        this.deliveredCards = [];
        this.detectedPhase = '';
        this.detectedTopic = '';
        this.reasoning = '';
        this.draftLong = '';
        this.draftShort = '';
        this.phoneCategory = '';
        this.phoneText = '';
        this.phoneShow = false;
        this.watchText = '';
        this.watchCategory = '';
        this.watchBuzz = false;
        this._cardSeq = 0;
        this._rollingSummary = '';
        this._currentPhase = '';
        this._lastNudgeText = '';
    }
}
