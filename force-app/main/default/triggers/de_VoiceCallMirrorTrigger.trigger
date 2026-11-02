/**
 * Mirrors VoiceCall rows onto de_AI_Call__c so the Customer 360 app can read the
 * AI calling history via the Data API. See de_VoiceCallMirror for the why.
 */
trigger de_VoiceCallMirrorTrigger on VoiceCall (after insert, after update) {
    de_VoiceCallMirror.sync(Trigger.new);
}
