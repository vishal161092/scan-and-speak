/**
 * de_ShowroomNudgeService
 * Controller for the de_showroomNudgeTheater LWC.
 *
 * Invokes the "Showroom_Nudge_Flex" Prompt Template with a live transcript chunk
 * plus the rolling context (running summary, current phase, last nudge) and returns
 * the template's structured coaching nudge. This is the exact same prompt the
 * Customer 360 web mock calls via getShowroomNudge(); the LWC threads the rolling
 * context between turns just like the 10s-chunk web pipeline does.
 *
 * The template is expected to return a JSON object of the shape:
 *   { "phase": "...", "topic": "...", "longNudge": "...", "shortNudge": "...",
 *     "isNew": true, "confidence": "high|medium|low", "rollingSummary": "..." }
 */
public with sharing class de_ShowroomNudgeService {

    // API name of the Prompt Template in Prompt Builder.
    private static final String TEMPLATE_API_NAME = 'Showroom_Nudge_Flex';

    // Fixed demo session — matches SF_NUDGE_SESSION_ID in the Customer 360 web app.
    private static final String DEFAULT_SESSION_ID = 'Demo-001';

    public class NudgeResult {
        @AuraEnabled public String phase;
        @AuraEnabled public String topic;
        @AuraEnabled public String longNudge;
        @AuraEnabled public String shortNudge;
        @AuraEnabled public Boolean isNew;
        @AuraEnabled public String confidence;
        @AuraEnabled public String rollingSummary;
        @AuraEnabled public String raw;      // full generation text (debugging)
    }

    // The latest coaching nudge written to Nudge__c by the live web session.
    public class LiveNudge {
        @AuraEnabled public String phase;
        @AuraEnabled public String topic;
        @AuraEnabled public String longNudge;
        @AuraEnabled public String shortNudge;
        @AuraEnabled public String rollingSummary;
        @AuraEnabled public String transcript;
        @AuraEnabled public String nudgeId;
        @AuraEnabled public String lastUpdated;   // ISO string
        @AuraEnabled public String signature;     // change-detection key for the LWC poll
    }

    /**
     * Poll the shared Nudge__c record for the latest nudge in a live session.
     * The de_showroomNudgeTheater LWC calls this every ~2s while "listening" so the
     * theater mirrors whatever the rep is saying into the Customer 360 web mic.
     * Returns null when no nudge has been written for the session yet.
     */
    @AuraEnabled(cacheable=false)
    public static LiveNudge getLatestNudge(String sessionId) {
        String sid = String.isBlank(sessionId) ? DEFAULT_SESSION_ID : sessionId;

        List<Nudge__c> rows = [
            SELECT Phase__c, Category__c, Long_Nudge__c, Text__c, Rolling_Summary__c,
                   Transcript_Chunk__c, Nudge_Id__c, Last_Updated__c, LastModifiedDate
            FROM Nudge__c
            WHERE Session_Id__c = :sid
            ORDER BY LastModifiedDate DESC
            LIMIT 1
        ];
        if (rows.isEmpty()) return null;

        Nudge__c n = rows[0];
        LiveNudge r = new LiveNudge();
        r.phase = n.Phase__c;
        r.topic = n.Category__c;
        r.longNudge = n.Long_Nudge__c;
        r.shortNudge = n.Text__c;
        r.rollingSummary = n.Rolling_Summary__c;
        r.transcript = n.Transcript_Chunk__c;
        r.nudgeId = n.Nudge_Id__c;
        r.lastUpdated = n.Last_Updated__c == null ? '' : n.Last_Updated__c.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'');

        // Prefer the generation id (changes every run); fall back to the modified
        // stamp so the LWC can still detect a fresh write if Nudge_Id__c is blank.
        r.signature = String.isNotBlank(n.Nudge_Id__c)
            ? n.Nudge_Id__c
            : String.valueOf(n.LastModifiedDate.getTime());
        return r;
    }

    /**
     * Generate the next coaching nudge for a live showroom conversation.
     *
     * @param latestTranscript the newest ~10s transcript chunk (the "input message")
     * @param rollingSummary   running summary carried from the previous turn
     * @param currentPhase     phase detected on the previous turn
     * @param lastNudgeText    the previous longNudge (so the model can avoid repeats)
     */
    @AuraEnabled
    public static NudgeResult getNudge(String latestTranscript,
                                       String rollingSummary,
                                       String currentPhase,
                                       String lastNudgeText) {
        ConnectApi.EinsteinPromptTemplateGenerationsInput genInput =
            new ConnectApi.EinsteinPromptTemplateGenerationsInput();
        genInput.isPreview = false;

        ConnectApi.EinsteinLlmAdditionalConfigInput cfg =
            new ConnectApi.EinsteinLlmAdditionalConfigInput();
        cfg.applicationName = 'PromptTemplateGenerationsInvocable';
        genInput.additionalConfig = cfg;

        Map<String, ConnectApi.WrappedValue> params = new Map<String, ConnectApi.WrappedValue>();
        params.put('Input:latestTranscript', wrap(latestTranscript));
        params.put('Input:rollingSummary', wrap(rollingSummary));
        params.put('Input:currentPhase', wrap(currentPhase));
        params.put('Input:lastNudgeText', wrap(lastNudgeText));
        genInput.inputParams = params;

        ConnectApi.EinsteinPromptTemplateGenerationsRepresentation gen;
        try {
            gen = ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(TEMPLATE_API_NAME, genInput);
        } catch (Exception e) {
            throw new AuraHandledException('Prompt template call failed: ' + e.getMessage());
        }

        if (gen == null || gen.generations == null || gen.generations.isEmpty()) {
            throw new AuraHandledException('Empty generation from prompt template ' + TEMPLATE_API_NAME);
        }

        return parse(gen.generations[0].text);
    }

    /** Extract the JSON object from the generation text (tolerates ```json fences / prose). */
    private static NudgeResult parse(String text) {
        NudgeResult r = new NudgeResult();
        r.raw = text;
        if (String.isBlank(text)) {
            throw new AuraHandledException('Empty generation text');
        }

        Integer start = text.indexOf('{');
        Integer stop = text.lastIndexOf('}');
        if (start < 0 || stop <= start) {
            throw new AuraHandledException('No JSON object found in generation: ' + text);
        }

        Map<String, Object> m;
        try {
            m = (Map<String, Object>) JSON.deserializeUntyped(text.substring(start, stop + 1));
        } catch (Exception e) {
            throw new AuraHandledException('Could not parse nudge JSON: ' + e.getMessage());
        }

        r.phase = str(m.get('phase'));
        r.topic = str(m.get('topic'));
        r.longNudge = str(m.get('longNudge'));
        r.shortNudge = str(m.get('shortNudge'));
        r.confidence = str(m.get('confidence'));
        r.rollingSummary = str(m.get('rollingSummary'));

        Object isNewO = m.get('isNew');
        if (isNewO == null) {
            r.isNew = true;
        } else if (isNewO instanceof Boolean) {
            r.isNew = (Boolean) isNewO;
        } else {
            r.isNew = Boolean.valueOf(String.valueOf(isNewO));
        }

        return r;
    }

    private static ConnectApi.WrappedValue wrap(String v) {
        ConnectApi.WrappedValue w = new ConnectApi.WrappedValue();
        w.value = v == null ? '' : v;
        return w;
    }

    private static String str(Object o) {
        return o == null ? '' : String.valueOf(o);
    }
}
