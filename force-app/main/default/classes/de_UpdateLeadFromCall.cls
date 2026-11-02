/**
 * de_UpdateLeadFromCall
 * Invocable action for the Velo Voice Agent. Called at the end of an outbound
 * qualification + test-ride call to write what was captured back onto the Lead.
 *
 * Lead resolution:
 *   If a VoiceCallId is supplied and that VoiceCall record is linked to a Lead
 *   (VoiceCall.de_Lead__c), that Lead Id REPLACES the passed-in leadId (which is
 *   only a seeded demo default in the agent). Otherwise the passed-in leadId is used.
 *
 * Field mapping (all target Lead fields are Text so free-form spoken values fit):
 *   Model_Interest__c      <- interestedModel
 *   Budget_Range__c        <- budgetRange
 *   Purchase_Timeframe__c  <- purchaseTimeline
 *   Trade_In_Vehicle__c    <- otherVehicles
 *   Preferred_Dealership__c<- dealership
 *   Test_Drive_Status__c   <- 'Scheduled' (when a test ride was booked)
 *   Status                 <- 'Qualified'
 *   Rating                 <- 'Hot'
 *   Description            <- structured call summary (incl. test-ride date/time/booking #)
 */
public with sharing class de_UpdateLeadFromCall {

    public class Request {
        @InvocableVariable(label='Lead Id' description='Default Lead Id to update (overridden by the VoiceCall\'s linked Lead when present)')
        public String leadId;

        @InvocableVariable(label='Voice Call Id' description='Id of the VoiceCall record; if it is linked to a Lead, that Lead is updated instead of the default Lead Id')
        public String voiceCallId;

        @InvocableVariable(label='Priority Preference' description='What the caller values most in the vehicle (space, comfort, performance or technology)')
        public String priorityPreference;

        @InvocableVariable(label='Budget Range' description='Caller budget as spoken')
        public String budgetRange;

        @InvocableVariable(label='Purchase Timeline' description='When the caller plans to buy')
        public String purchaseTimeline;

        @InvocableVariable(label='Other Vehicles' description='Other cars/brands being considered')
        public String otherVehicles;

        @InvocableVariable(label='Interested Model' description='Velo model of interest')
        public String interestedModel;

        @InvocableVariable(label='Dealership' description='Preferred / suggested dealership')
        public String dealership;

        @InvocableVariable(label='Test Ride Date' description='Test-ride date as spoken')
        public String testRideDate;

        @InvocableVariable(label='Test Ride Time' description='Test-ride time as spoken')
        public String testRideTime;

        @InvocableVariable(label='Booking Id' description='Test-ride booking confirmation number')
        public String bookingId;
    }

    public class Result {
        @InvocableVariable(label='Success' description='True if the Lead was updated')
        public Boolean success;

        @InvocableVariable(label='Message' description='Human-readable outcome')
        public String message;
    }

    @InvocableMethod(label='Update Lead From Call'
        description='Writes captured qualification and test-ride details back onto the Lead')
    public static List<Result> updateLead(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Result r = new Result();
            try {
                // Resolve the Lead to update: prefer the Lead linked on the VoiceCall.
                String targetLeadId = resolveLeadId(req);

                if (String.isBlank(targetLeadId)) {
                    r.success = false;
                    r.message = 'No Lead Id available (VoiceCall not linked to a Lead and no default Lead Id provided).';
                    results.add(r);
                    continue;
                }

                List<String> notes = new List<String>();
                notes.add('--- Velo Voice Agent call summary ---');
                if (String.isNotBlank(req.interestedModel))  notes.add('Interested model: ' + req.interestedModel);
                if (String.isNotBlank(req.priorityPreference)) notes.add('Values most: ' + req.priorityPreference);
                if (String.isNotBlank(req.budgetRange))       notes.add('Budget: ' + req.budgetRange);
                if (String.isNotBlank(req.purchaseTimeline))  notes.add('Purchase timeframe: ' + req.purchaseTimeline);
                if (String.isNotBlank(req.otherVehicles))     notes.add('Also considering: ' + req.otherVehicles);
                if (String.isNotBlank(req.dealership))         notes.add('Preferred dealership: ' + req.dealership);
                if (String.isNotBlank(req.testRideDate) || String.isNotBlank(req.testRideTime)) {
                    notes.add('Test ride: ' + req.testRideDate + ' ' + req.testRideTime);
                }
                if (String.isNotBlank(req.bookingId))          notes.add('Booking #: ' + req.bookingId);

                Lead ld = new Lead(Id = targetLeadId);
                ld.Status = 'Qualified';
                ld.Rating = 'Hot';
                ld.Description = String.join(notes, '\n');

                // Map captured values onto the Lead's own (now Text) fields.
                if (String.isNotBlank(req.interestedModel))  ld.Model_Interest__c = req.interestedModel;
                if (String.isNotBlank(req.budgetRange))       ld.Budget_Range__c = req.budgetRange;
                if (String.isNotBlank(req.purchaseTimeline))  ld.Purchase_Timeframe__c = req.purchaseTimeline;
                if (String.isNotBlank(req.otherVehicles))     ld.Trade_In_Vehicle__c = req.otherVehicles;
                if (String.isNotBlank(req.dealership))         ld.Preferred_Dealership__c = req.dealership;
                if (String.isNotBlank(req.testRideDate) || String.isNotBlank(req.testRideTime)) {
                    ld.Test_Drive_Status__c = 'Scheduled';
                }

                update ld;

                r.success = true;
                r.message = 'Lead ' + targetLeadId + ' updated (Qualified / Hot) with call details.';
            } catch (Exception e) {
                r.success = false;
                r.message = 'Update failed: ' + e.getMessage();
            }
            results.add(r);
        }
        return results;
    }

    /**
     * Returns the Lead Id to update, in priority order:
     *   1. The Lead explicitly linked on the VoiceCall (VoiceCall.de_Lead__c).
     *   2. A Lead whose Phone / MobilePhone matches the call's phone numbers
     *      (To/From), compared on the last 10 digits so formatting differences
     *      (spaces, +91, dashes) don't prevent a match.
     *   3. The default leadId supplied by the agent.
     */
    private static String resolveLeadId(Request req) {
        if (String.isBlank(req.voiceCallId)) {
            return req.leadId;
        }

        List<VoiceCall> calls = [
            SELECT de_Lead__c, ToPhoneNumber, FromPhoneNumber
            FROM VoiceCall
            WHERE Id = :req.voiceCallId
            LIMIT 1
        ];
        if (calls.isEmpty()) {
            return req.leadId;
        }

        VoiceCall call = calls[0];

        // 1. Explicit link wins.
        if (call.de_Lead__c != null) {
            return call.de_Lead__c;
        }

        // 2. Fall back to matching the caller's phone number to a Lead.
        String matchedLeadId = findLeadByPhone(
            new List<String>{ call.ToPhoneNumber, call.FromPhoneNumber }
        );
        if (String.isNotBlank(matchedLeadId)) {
            return matchedLeadId;
        }

        // 3. Default seed.
        return req.leadId;
    }

    /**
     * Finds a Lead whose Phone or MobilePhone matches any of the supplied call
     * numbers on their last 10 digits. Returns null if none match.
     */
    private static String findLeadByPhone(List<String> callNumbers) {
        Set<String> keys = new Set<String>();
        for (String n : callNumbers) {
            String key = last10(n);
            if (String.isNotBlank(key)) keys.add(key);
        }
        if (keys.isEmpty()) return null;

        // Tier A — fast SOQL LIKE for numbers stored without internal separators.
        for (String key : keys) {
            String pattern = '%' + key + '%';
            List<Lead> hits = [
                SELECT Id FROM Lead
                WHERE Phone LIKE :pattern OR MobilePhone LIKE :pattern
                LIMIT 1
            ];
            if (!hits.isEmpty()) return hits[0].Id;
        }

        // Tier B — normalize-compare for numbers stored with formatting.
        for (Lead ld : [
            SELECT Id, Phone, MobilePhone
            FROM Lead
            WHERE Phone != null OR MobilePhone != null
            ORDER BY LastModifiedDate DESC
            LIMIT 500
        ]) {
            if (keys.contains(last10(ld.Phone)) || keys.contains(last10(ld.MobilePhone))) {
                return ld.Id;
            }
        }
        return null;
    }

    /** Strips non-digits and returns the last 10 digits (India mobile length), or '' if too short. */
    private static String last10(String phone) {
        if (String.isBlank(phone)) return '';
        String digits = phone.replaceAll('[^0-9]', '');
        return digits.length() >= 10 ? digits.substring(digits.length() - 10) : '';
    }
}
