/**
 * de_VoiceCallMirror
 * Keeps the de_AI_Call__c mirror object in sync with VoiceCall records.
 *
 * VoiceCall is a feature-gated Service Cloud Voice object that the Customer 360
 * app's client-credentials token cannot query over the REST API (it returns
 * INVALID_AUTH_HEADER). We copy the fields the app needs onto de_AI_Call__c,
 * which the app CAN read through the standard Data API. Upsert keys on the
 * source VoiceCall Id (external id) so each call maps to exactly one mirror row.
 */
public with sharing class de_VoiceCallMirror {

    public static void sync(List<VoiceCall> calls) {
        if (calls == null || calls.isEmpty()) {
            return;
        }
        List<de_AI_Call__c> mirrors = new List<de_AI_Call__c>();
        for (VoiceCall vc : calls) {
            de_AI_Call__c m = new de_AI_Call__c();
            m.Name = vc.Name != null ? vc.Name.left(80) : 'AI Call';
            m.de_VoiceCall_Id__c = vc.Id;
            m.de_Lead__c = vc.de_Lead__c;
            m.de_Call_Type__c = vc.CallType;
            m.de_Call_Start__c = vc.CallStartDateTime;
            m.de_Duration_Seconds__c = vc.CallDurationInSeconds;
            m.de_Is_Recorded__c = vc.IsRecorded == true;
            m.de_Disposition__c = vc.CallDisposition;
            m.de_Reason__c = vc.Call_Reason__c;
            m.de_Agent_Sentiment__c = vc.AgentSentimentScore;
            m.de_Customer_Sentiment__c = vc.CustomerSentimentScore;
            m.de_Description__c = vc.Description;
            mirrors.add(m);
        }
        upsert mirrors de_VoiceCall_Id__c;
    }

    /** One-time / on-demand backfill for VoiceCalls that already exist. */
    public static Integer backfillAll() {
        List<VoiceCall> calls = [
            SELECT Id, Name, CallType, CallStartDateTime, CallDurationInSeconds,
                   IsRecorded, CallDisposition, Call_Reason__c,
                   AgentSentimentScore, CustomerSentimentScore, Description, de_Lead__c
            FROM VoiceCall
            WHERE de_Lead__c != null
        ];
        sync(calls);
        return calls.size();
    }
}
