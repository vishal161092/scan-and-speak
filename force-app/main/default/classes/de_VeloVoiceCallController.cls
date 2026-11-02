/**
 * Supplies the AI Calling History LWC with the VoiceCall records linked to a
 * Lead (via de_Lead__c), newest first, plus:
 *   - a playable recording URL resolved from the call recording File, and
 *   - the REAL conversation transcript, fetched live per call from the Service
 *     Cloud Voice Connect API (see de_VoiceConnectService).
 *
 * getCalls is cacheable (metadata only). getTranscript is a separate, non-
 * cacheable method because cacheable Apex cannot make callouts; the LWC calls
 * it imperatively for whichever call is selected, so the transcript is dynamic
 * for any VoiceCall. Insights (summary/sentiment/etc.) are still mocked in the LWC.
 */
public with sharing class de_VeloVoiceCallController {
    private static final Set<String> AUDIO_TYPES = new Set<String>{
        'MP3', 'WAV', 'M4A', 'OGG', 'AAC', 'MP4'
    };

    public class TurnDTO {
        @AuraEnabled public String speaker; // Agent (AI) / Customer
        @AuraEnabled public String t;       // mm:ss offset
        @AuraEnabled public String text;    // spoken text (original language)
    }

    public class CallDTO {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String callType;
        @AuraEnabled public Datetime startTime;
        @AuraEnabled public Integer durationSeconds;
        @AuraEnabled public Boolean isRecorded;
        @AuraEnabled public String disposition;
        @AuraEnabled public String reason;
        @AuraEnabled public String recordingUrl;
    }

    @AuraEnabled(cacheable=true)
    public static List<CallDTO> getCalls(Id recordId) {
        List<CallDTO> out = new List<CallDTO>();
        if (recordId == null) {
            return out;
        }

        List<VoiceCall> calls = [
            SELECT Id, Name, CallType, CallStartDateTime, CallDurationInSeconds,
                   IsRecorded, CallDisposition, Call_Reason__c
            FROM VoiceCall
            WHERE de_Lead__c = :recordId
            ORDER BY CallStartDateTime DESC NULLS LAST
            LIMIT 50
        ];
        if (calls.isEmpty()) {
            return out;
        }

        Map<Id, Id> callToRecording = resolveRecordings(calls);

        for (VoiceCall vc : calls) {
            CallDTO d = new CallDTO();
            d.id = vc.Id;
            d.name = vc.Name;
            d.callType = vc.CallType;
            d.startTime = vc.CallStartDateTime;
            d.durationSeconds = vc.CallDurationInSeconds;
            d.isRecorded = vc.IsRecorded;
            d.disposition = vc.CallDisposition;
            d.reason = vc.Call_Reason__c;
            Id cvId = callToRecording.get(vc.Id);
            d.recordingUrl = (cvId == null)
                ? null
                : '/sfc/servlet.shepherd/version/download/' + cvId;
            out.add(d);
        }
        return out;
    }

    /**
     * Live transcript for one VoiceCall. Resolves the call's VendorCallKey
     * (the conversation identifier), calls the Connect API, and returns the
     * turns oldest-first with mm:ss offsets. Not cacheable (makes a callout).
     */
    @AuraEnabled
    public static List<TurnDTO> getTranscript(Id voiceCallId) {
        List<TurnDTO> turns = new List<TurnDTO>();
        if (voiceCallId == null) {
            return turns;
        }
        List<VoiceCall> vcs = [
            SELECT Id, VendorCallKey FROM VoiceCall WHERE Id = :voiceCallId LIMIT 1
        ];
        if (vcs.isEmpty() || String.isBlank(vcs[0].VendorCallKey)) {
            return turns;
        }
        try {
            String body = de_VoiceConnectService.getConversationEntries(vcs[0].VendorCallKey);
            turns = parseEntries(body);
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
        return turns;
    }

    // Parse the Connect API response into ordered TurnDTOs.
    private static List<TurnDTO> parseEntries(String body) {
        List<TurnDTO> turns = new List<TurnDTO>();
        if (String.isBlank(body)) {
            return turns;
        }
        Map<String, Object> root = (Map<String, Object>) JSON.deserializeUntyped(body);
        List<Object> entries = (List<Object>) root.get('conversationEntries');
        if (entries == null) {
            return turns;
        }

        // Collect (timestamp, role, text), skipping entries without spoken text.
        List<Map<String, Object>> rows = new List<Map<String, Object>>();
        Long minTs = null;
        for (Object o : entries) {
            Map<String, Object> e = (Map<String, Object>) o;
            String text = (String) e.get('messageText');
            if (String.isBlank(text)) {
                continue;
            }
            Long ts = e.get('clientTimestamp') == null
                ? 0L : (Long) e.get('clientTimestamp');
            if (minTs == null || ts < minTs) {
                minTs = ts;
            }
            String role = '';
            if (e.get('sender') instanceof Map<String, Object>) {
                role = (String) ((Map<String, Object>) e.get('sender')).get('role');
            }
            rows.add(new Map<String, Object>{
                'ts' => ts, 'role' => role, 'text' => text.trim()
            });
        }
        // Oldest first.
        rows.sort(new TsComparator());

        Long base = minTs == null ? 0L : minTs;
        for (Map<String, Object> r : rows) {
            TurnDTO turn = new TurnDTO();
            String role = (String) r.get('role');
            turn.speaker = (role == 'EndUser' || role == 'Customer') ? 'Customer' : 'Agent';
            Long offset = ((Long) r.get('ts') - base) / 1000;
            if (offset < 0) {
                offset = 0;
            }
            Integer secs = offset.intValue();
            Integer ss = Math.mod(secs, 60);
            turn.t = (secs / 60) + ':' + (ss < 10 ? '0' + ss : String.valueOf(ss));
            turn.text = (String) r.get('text');
            turns.add(turn);
        }
        return turns;
    }

    private class TsComparator implements Comparator<Object> {
        public Integer compare(Object a, Object b) {
            Long ta = (Long) ((Map<String, Object>) a).get('ts');
            Long tb = (Long) ((Map<String, Object>) b).get('ts');
            return ta == tb ? 0 : (ta < tb ? -1 : 1);
        }
    }

    // Resolve, per VoiceCall, the latest audio ContentVersion linked to it.
    private static Map<Id, Id> resolveRecordings(List<VoiceCall> calls) {
        Map<Id, Id> callToVersion = new Map<Id, Id>();
        Set<Id> callIds = new Map<Id, VoiceCall>(calls).keySet();
        Map<Id, Id> docToCall = new Map<Id, Id>();
        for (ContentDocumentLink link : [
            SELECT ContentDocumentId, LinkedEntityId,
                   ContentDocument.FileType
            FROM ContentDocumentLink
            WHERE LinkedEntityId IN :callIds
        ]) {
            String ftype = link.ContentDocument.FileType;
            if (ftype != null && AUDIO_TYPES.contains(ftype)
                    && !docToCall.containsKey(link.ContentDocumentId)) {
                docToCall.put(link.ContentDocumentId, link.LinkedEntityId);
            }
        }
        if (docToCall.isEmpty()) {
            return callToVersion;
        }
        for (ContentVersion cv : [
            SELECT Id, ContentDocumentId
            FROM ContentVersion
            WHERE ContentDocumentId IN :docToCall.keySet() AND IsLatest = true
        ]) {
            Id callId = docToCall.get(cv.ContentDocumentId);
            if (callId != null && !callToVersion.containsKey(callId)) {
                callToVersion.put(callId, cv.Id);
            }
        }
        return callToVersion;
    }
}
