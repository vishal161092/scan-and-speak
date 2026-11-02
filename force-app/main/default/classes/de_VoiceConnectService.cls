/**
 * Authenticates to this org via the OAuth 2.0 Client Credentials flow and calls
 * the Service Cloud Voice Connect API to retrieve a conversation's transcript
 * entries live. Reuses the existing "Service Client 360 App" External Client
 * App (the same app the Service 360 web app uses) — so NO certificate, NO new
 * connected app, and NO digital-signature/pre-authorization setup is needed.
 *
 * One-time setup (see de_Voice_Connect__mdt.Default):
 *   1. Put the External Client App's Consumer Key   into Consumer_Key__c.
 *   2. Put the External Client App's Consumer Secret into Consumer_Secret__c.
 * (The app is already enabled for the client-credentials flow with a run-as
 * user; that user needs access to the Voice conversation data.)
 *
 * The controller (de_VeloVoiceCallController.getTranscript) calls this.
 */
public with sharing class de_VoiceConnectService {
    private static String cachedToken;   // per-transaction token reuse
    private static String cachedInstance;

    public class VoiceConnectException extends Exception {}

    /** Raw JSON body from /connect/conversation/{cid}/entries. */
    public static String getConversationEntries(String conversationIdentifier) {
        if (String.isBlank(conversationIdentifier)) {
            throw new VoiceConnectException('Missing conversation identifier.');
        }
        de_Voice_Connect__mdt cfg = config();
        if (cachedToken == null) {
            authenticate(cfg);
        }
        String apiVer = String.isBlank(cfg.Api_Version__c) ? '61.0' : cfg.Api_Version__c;
        HttpRequest req = new HttpRequest();
        req.setEndpoint(cachedInstance + '/services/data/v' + apiVer
            + '/connect/conversation/' + conversationIdentifier + '/entries');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + cachedToken);
        req.setTimeout(60000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new VoiceConnectException('Connect API returned '
                + res.getStatusCode() + ': ' + res.getBody());
        }
        return res.getBody();
    }

    private static de_Voice_Connect__mdt config() {
        de_Voice_Connect__mdt cfg = de_Voice_Connect__mdt.getInstance('Default');
        if (cfg == null || String.isBlank(cfg.Consumer_Key__c)
                || String.isBlank(cfg.Consumer_Secret__c)) {
            throw new VoiceConnectException(
                'de_Voice_Connect__mdt.Default is missing Consumer Key / Consumer Secret. '
                + 'Paste the Service Client 360 App credentials into the record first.');
        }
        return cfg;
    }

    private static void authenticate(de_Voice_Connect__mdt cfg) {
        String host = String.isBlank(cfg.Login_Host__c)
            ? URL.getOrgDomainUrl().toExternalForm() : cfg.Login_Host__c;

        HttpRequest req = new HttpRequest();
        req.setEndpoint(host + '/services/oauth2/token');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody('grant_type=client_credentials'
            + '&client_id=' + EncodingUtil.urlEncode(cfg.Consumer_Key__c, 'UTF-8')
            + '&client_secret=' + EncodingUtil.urlEncode(cfg.Consumer_Secret__c, 'UTF-8'));
        req.setTimeout(60000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new VoiceConnectException('Client-credentials token exchange failed ('
                + res.getStatusCode() + '): ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        cachedToken = (String) body.get('access_token');
        cachedInstance = (String) body.get('instance_url');
        if (String.isBlank(cachedInstance)) {
            cachedInstance = host;
        }
        if (String.isBlank(cachedToken)) {
            throw new VoiceConnectException('No access_token in token response.');
        }
    }
}
