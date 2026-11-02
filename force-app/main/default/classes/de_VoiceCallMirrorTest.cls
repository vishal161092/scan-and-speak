/**
 * Exercises de_VoiceCallMirror.sync. VoiceCall is not reliably insertable in a
 * test context, so we build an in-memory VoiceCall (with an Id injected via JSON
 * deserialization) and hand it to the handler directly, then assert the mirror
 * row was created and linked to the Lead.
 */
@isTest
private class de_VoiceCallMirrorTest {

    @isTest
    static void mirrorsAndUpsertsByVoiceCallId() {
        Lead ld = new Lead(LastName = 'Mirror Test', Company = 'Acme');
        insert ld;

        VoiceCall vc = (VoiceCall) JSON.deserialize(
            '{"attributes":{"type":"VoiceCall"},"Id":"0LQ000000000001AAA",' +
            '"Name":"VC-TEST-01","CallType":"Inbound","CallDurationInSeconds":145,' +
            '"IsRecorded":true,"CallDisposition":"completed"}',
            VoiceCall.class
        );
        vc.de_Lead__c = ld.Id;

        Test.startTest();
        de_VoiceCallMirror.sync(new List<VoiceCall>{ vc });
        // Second run with the same VoiceCall Id must update, not duplicate.
        de_VoiceCallMirror.sync(new List<VoiceCall>{ vc });
        Test.stopTest();

        List<de_AI_Call__c> mirrors = [
            SELECT Id, de_Lead__c, de_Call_Type__c, de_Duration_Seconds__c, de_Is_Recorded__c
            FROM de_AI_Call__c
            WHERE de_VoiceCall_Id__c = '0LQ000000000001AAA'
        ];
        System.assertEquals(1, mirrors.size(), 'exactly one mirror row per VoiceCall');
        System.assertEquals(ld.Id, mirrors[0].de_Lead__c, 'linked to the Lead');
        System.assertEquals('Inbound', mirrors[0].de_Call_Type__c);
        System.assertEquals(145, mirrors[0].de_Duration_Seconds__c);
        System.assertEquals(true, mirrors[0].de_Is_Recorded__c);
    }

    @isTest
    static void syncHandlesEmpty() {
        Test.startTest();
        de_VoiceCallMirror.sync(new List<VoiceCall>());
        de_VoiceCallMirror.sync(null);
        Test.stopTest();
        System.assertEquals(0, [SELECT COUNT() FROM de_AI_Call__c]);
    }
}
