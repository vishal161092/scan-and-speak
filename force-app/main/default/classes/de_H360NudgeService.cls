/**
 * de_H360NudgeService
 * REST endpoint that powers the "live nudges" in the Velo Service 360 mobile app.
 *
 * POST /services/apexrest/nudge
 * Body:  { "recordId": "003...", "transcriptChunk": "...", "fullTranscript": "..." }
 * Reply: { "nudges": [ { "priority": "high|medium|low", "title": "...", "detail": "..." } ] }
 *
 * It gathers the customer's live context (open cases, assets) from the org, hands that
 * plus the latest transcript chunk to a Prompt Template, and returns the template's
 * suggested next-best-actions. If the Prompt Template is not configured or errors, it
 * falls back to record-grounded heuristics so the app always gets useful nudges.
 */
@RestResource(urlMapping='/nudge/*')
global with sharing class de_H360NudgeService {

    // Set this to the API name of your Prompt Template in Prompt Builder.
    // Leave blank to use the record-grounded heuristic engine only.
    private static final String PROMPT_TEMPLATE_API_NAME = '';

    global class NudgeRequest {
        public String recordId;
        public String transcriptChunk;
        public String fullTranscript;
    }

    global class Nudge {
        public String priority;
        public String title;
        public String detail;
        public Nudge(String p, String t, String d) { priority = p; title = t; detail = d; }
    }

    global class NudgeResponse {
        public String source;
        public List<Nudge> nudges;
    }

    @HttpPost
    global static NudgeResponse post() {
        RestRequest req = RestContext.request;
        NudgeRequest input;
        try {
            input = (NudgeRequest) JSON.deserialize(req.requestBody.toString(), NudgeRequest.class);
        } catch (Exception e) {
            input = new NudgeRequest();
        }

        NudgeResponse resp = new NudgeResponse();
        resp.nudges = new List<Nudge>();

        String context = buildContext(input == null ? null : input.recordId);

        // 1) Try the Prompt Template (the "prompt in Salesforce").
        if (String.isNotBlank(PROMPT_TEMPLATE_API_NAME)) {
            try {
                List<Nudge> fromPrompt = callPromptTemplate(input, context);
                if (fromPrompt != null && !fromPrompt.isEmpty()) {
                    resp.source = 'prompt-template';
                    resp.nudges = fromPrompt;
                    return resp;
                }
            } catch (Exception e) {
                // fall through to heuristics
            }
        }

        // 2) Record-grounded heuristic fallback.
        resp.source = 'heuristic';
        resp.nudges = heuristicNudges(input == null ? null : input.recordId,
                                      input == null ? '' : input.transcriptChunk);
        return resp;
    }

    /** True when the id is a Lead (key prefix 00Q). */
    private static Boolean isLead(String recordId) {
        return String.isNotBlank(recordId) && recordId.startsWith('00Q');
    }

    /** Assemble a compact text summary of the customer's live 360 for prompt grounding. */
    private static String buildContext(String recordId) {
        if (String.isBlank(recordId)) return '';

        if (isLead(recordId)) {
            List<String> leadLines = new List<String>();
            try {
                for (Lead ld : [
                    SELECT Name, Company, Status, LeadSource, Rating, City, State, Industry, Description
                    FROM Lead
                    WHERE Id = :recordId
                    LIMIT 1
                ]) {
                    leadLines.add('Lead: ' + ld.Name + ' (' + ld.Rating + '/' + ld.Status + ')');
                    if (String.isNotBlank(ld.LeadSource)) leadLines.add('Source: ' + ld.LeadSource);
                    if (String.isNotBlank(ld.City)) leadLines.add('Location: ' + ld.City + (String.isNotBlank(ld.State) ? ', ' + ld.State : ''));
                    if (String.isNotBlank(ld.Description)) leadLines.add('Notes: ' + ld.Description);
                }
            } catch (Exception e) { /* skip */ }
            return String.join(leadLines, '\n');
        }

        List<String> lines = new List<String>();
        try {
            for (Case c : [
                SELECT CaseNumber, Subject, Status, Priority
                FROM Case
                WHERE ContactId = :recordId
                ORDER BY CreatedDate DESC
                LIMIT 10
            ]) {
                lines.add('Open case #' + c.CaseNumber + ' (' + c.Priority + '/' + c.Status + '): ' + c.Subject);
            }
        } catch (Exception e) { /* object not accessible; skip */ }
        try {
            for (Asset a : [
                SELECT Name, Status, SerialNumber
                FROM Asset
                WHERE ContactId = :recordId
                ORDER BY InstallDate DESC
                LIMIT 10
            ]) {
                lines.add('Asset: ' + a.Name + ' (' + a.Status + ')');
            }
        } catch (Exception e) { /* skip */ }
        return String.join(lines, '\n');
    }

    /**
     * Invoke the Prompt Template via ConnectApi and parse a JSON nudge array from its output.
     * The template is expected to return a JSON array like:
     *   [ { "priority": "high", "title": "...", "detail": "..." } ]
     */
    private static List<Nudge> callPromptTemplate(NudgeRequest input, String context) {
        ConnectApi.EinsteinPromptTemplateGenerationsInput genInput =
            new ConnectApi.EinsteinPromptTemplateGenerationsInput();
        genInput.isPreview = false;

        ConnectApi.EinsteinLlmAdditionalConfigInput cfg = new ConnectApi.EinsteinLlmAdditionalConfigInput();
        cfg.applicationName = 'Velo_Service_360';
        genInput.additionalConfig = cfg;

        Map<String, ConnectApi.WrappedValue> params = new Map<String, ConnectApi.WrappedValue>();
        params.put('Input:transcript', wrap(input != null ? input.transcriptChunk : ''));
        params.put('Input:context', wrap(context));
        params.put('Input:recordId', wrap(input != null ? input.recordId : ''));
        genInput.inputParams = params;

        ConnectApi.EinsteinPromptTemplateGenerationsRepresentation gen =
            ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(PROMPT_TEMPLATE_API_NAME, genInput);

        if (gen == null || gen.generations == null || gen.generations.isEmpty()) return null;
        String text = gen.generations[0].text;
        return parseNudges(text);
    }

    private static ConnectApi.WrappedValue wrap(String v) {
        ConnectApi.WrappedValue w = new ConnectApi.WrappedValue();
        w.value = v == null ? '' : v;
        return w;
    }

    private static List<Nudge> parseNudges(String text) {
        List<Nudge> out = new List<Nudge>();
        if (String.isBlank(text)) return out;
        // Extract the JSON array if the model wrapped it in prose.
        Integer start = text.indexOf('[');
        Integer stop = text.lastIndexOf(']');
        if (start >= 0 && stop > start) {
            String jsonArr = text.substring(start, stop + 1);
            try {
                List<Object> items = (List<Object>) JSON.deserializeUntyped(jsonArr);
                for (Object o : items) {
                    Map<String, Object> m = (Map<String, Object>) o;
                    out.add(new Nudge(
                        str(m.get('priority'), 'low'),
                        str(m.get('title'), 'Suggestion'),
                        str(m.get('detail'), '')
                    ));
                }
            } catch (Exception e) { /* leave empty -> fallback */ }
        }
        return out;
    }

    private static String str(Object o, String dflt) {
        return o == null ? dflt : String.valueOf(o);
    }

    /** Deterministic, record-grounded suggestions used when no prompt template is wired. */
    private static List<Nudge> heuristicNudges(String recordId, String chunk) {
        List<Nudge> out = new List<Nudge>();
        String t = (chunk == null ? '' : chunk).toLowerCase();

        // Lead scenario: qualification + test-ride nudges.
        if (isLead(recordId)) {
            return leadNudges(recordId, t);
        }

        if (String.isNotBlank(recordId)) {
            try {
                List<Case> open = [
                    SELECT CaseNumber, Subject, Priority
                    FROM Case
                    WHERE ContactId = :recordId AND IsClosed = false
                    ORDER BY CreatedDate DESC
                    LIMIT 3
                ];
                for (Case c : open) {
                    out.add(new Nudge(
                        c.Priority == 'High' ? 'high' : 'medium',
                        'Open case #' + c.CaseNumber,
                        'Address this open issue: ' + c.Subject
                    ));
                }
            } catch (Exception e) { /* skip */ }
        }

        if ((t.contains('service') || t.contains('सर्विस')) && out.isEmpty()) {
            out.add(new Nudge('medium', 'Service opportunity',
                'Customer mentioned service — check due date and offer to bundle today.'));
        }
        if (out.isEmpty()) {
            out.add(new Nudge('low', 'Keep listening',
                'Ask why the customer came in today; next best actions will surface from the transcript.'));
        }
        return out;
    }

    /** Lead-qualification & test-ride next-best-actions for the sales scenario. */
    private static List<Nudge> leadNudges(String recordId, String t) {
        List<Nudge> out = new List<Nudge>();

        Lead ld;
        try {
            ld = [SELECT Name, Status, Rating, LeadSource, City FROM Lead WHERE Id = :recordId LIMIT 1];
        } catch (Exception e) { ld = null; }

        Boolean unqualified = ld == null
            || String.isBlank(ld.Status)
            || ld.Status.containsIgnoreCase('Open')
            || ld.Status.containsIgnoreCase('Not Contacted');

        // Transcript-driven signals.
        Boolean saysTestRide = t.contains('test ride') || t.contains('test drive')
            || t.contains('testride') || t.contains('टेस्ट') || t.contains('ड्राइव');
        Boolean saysFinance = t.contains('emi') || t.contains('budget') || t.contains('price')
            || t.contains('finance') || t.contains('loan') || t.contains('कीमत') || t.contains('ईएमआई') || t.contains('बजट');

        // Detect an interested model from the conversation.
        String model = null;
        for (String m : new List<String>{ 'orion x7', 'ranger', 'orion x5', 'orion x3', 'stallion', 'trekker', 'orion e4', 'voyager' }) {
            if (t.contains(m)) { model = m.toUpperCase(); break; }
        }

        if (unqualified) {
            out.add(new Nudge('high', 'Qualify this lead',
                'Confirm the interested model, budget range, and purchase timeline, then update the Lead status.'));
        }
        if (model != null) {
            out.add(new Nudge('medium', 'Interested in ' + model,
                'Share current offers, variants, and EMI options for the ' + model + '. Set up a test ride.'));
        }
        if (saysTestRide) {
            out.add(new Nudge('high', 'Book a test ride',
                'Capture preferred date, time, and dealership, then confirm the test-ride booking.'));
        }
        if (saysFinance) {
            out.add(new Nudge('medium', 'Discuss financing',
                'Walk through EMI plans and any exchange bonus; offer to connect the finance desk.'));
        }

        if (out.isEmpty()) {
            out.add(new Nudge('low', 'Open the qualification',
                'Ask which Velo model they are interested in and their buying timeline.'));
        }
        return out;
    }
}
