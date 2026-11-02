/**
 * de_VoiceCallHistoryApi
 * REST endpoint that returns the AI Calling History (VoiceCall rows linked to a
 * Lead via de_Lead__c) to the Customer 360 mobile app.
 *
 * Why this exists: the app's Salesforce integration runs through a
 * client-credentials Connected App whose token cannot query the feature-gated
 * VoiceCall object directly over the REST Query API — it returns
 * INVALID_AUTH_HEADER even for a System Administrator user, because VoiceCall's
 * REST handler requires an OAuth scope the client-credentials token lacks. The
 * token CAN, however, invoke Apex REST, and Apex SOQL runs in system context.
 * So we query VoiceCall here and hand back the same fields the app needs.
 *
 * GET /services/apexrest/de/voicecalls?leadId=00Q...
 * Reply: { "calls": [ { id, name, callType, startTime, durationSeconds,
 *          isRecorded, disposition, reason, agentSentiment, customerSentiment,
 *          description } ] }
 */
@RestResource(urlMapping='/de/voicecalls/*')
global with sharing class de_VoiceCallHistoryApi {

    global class CallDTO {
        public String id;
        public String name;
        public String callType;
        public Datetime startTime;
        public Integer durationSeconds;
        public Boolean isRecorded;
        public String disposition;
        public String reason;
        public Double agentSentiment;
        public Double customerSentiment;
        public String description;
    }

    global class VoiceCallResponse {
        public List<CallDTO> calls;
    }

    @HttpGet
    global static VoiceCallResponse doGet() {
        VoiceCallResponse resp = new VoiceCallResponse();
        resp.calls = new List<CallDTO>();

        String leadId = RestContext.request.params.get('leadId');
        if (String.isBlank(leadId)) {
            return resp;
        }

        for (VoiceCall vc : [
            SELECT Id, Name, CallType, CallStartDateTime, CallDurationInSeconds,
                   IsRecorded, CallDisposition, Call_Reason__c,
                   AgentSentimentScore, CustomerSentimentScore, Description
            FROM VoiceCall
            WHERE de_Lead__c = :leadId
            ORDER BY CallStartDateTime DESC NULLS LAST
            LIMIT 20
        ]) {
            CallDTO d = new CallDTO();
            d.id = vc.Id;
            d.name = vc.Name;
            d.callType = vc.CallType;
            d.startTime = vc.CallStartDateTime;
            d.durationSeconds = vc.CallDurationInSeconds;
            d.isRecorded = vc.IsRecorded;
            d.disposition = vc.CallDisposition;
            d.reason = vc.Call_Reason__c;
            d.agentSentiment = vc.AgentSentimentScore;
            d.customerSentiment = vc.CustomerSentimentScore;
            d.description = vc.Description;
            resp.calls.add(d);
        }
        return resp;
    }
}
