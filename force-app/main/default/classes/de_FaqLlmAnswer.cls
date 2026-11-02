/**
 * de_FaqLlmAnswer
 * Invocable action for the Velo Voice Agent's General FAQ subagent.
 *
 * Answers any customer question by calling the Salesforce Models API (LLM), so
 * the agent can respond conversationally even when no knowledge article matches.
 * Single input: the customer's question. Returns a short, spoken-style answer.
 */
public with sharing class de_FaqLlmAnswer {

    // Foundation model served through the Models API (fast, low-latency for a phone call).
    private static final String MODEL = 'sfdc_ai__DefaultOpenAIGPT4OmniMini';

    private static final String SYSTEM_PROMPT =
        'You are Anika, Velo\'s friendly AI voice assistant on a live phone call with a customer '
        + 'about Velo cars, especially the Velo Orion X7. Answer the customer\'s question helpfully '
        + 'in a warm, conversational tone. Reply in the SAME language the customer used (Hindi or English); '
        + 'if Hindi, use natural spoken Hindi. Keep it short — one to three sentences — since this is a phone '
        + 'call. If you are unsure or it truly needs a human, say so briefly and offer to connect them to a '
        + 'specialist. Never invent prices, offers, or specifications you are not certain about.';

    public class Request {
        @InvocableVariable(label='Question' description='The question the customer asked' required=true)
        public String question;
    }

    public class Result {
        @InvocableVariable(label='Answer' description='The generated answer to read back to the customer')
        public String answer;
    }

    @InvocableMethod(label='Answer FAQ with LLM'
        description='Answers a customer question conversationally using the Models API (LLM)')
    public static List<Result> answer(List<Request> requests) {
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Result r = new Result();
            try {
                r.answer = generate(req.question);
            } catch (Exception e) {
                r.answer = 'माफ़ कीजिए, अभी मैं इसका जवाब नहीं दे पा रही। क्या मैं आपको हमारे एक्सपर्ट से जोड़ दूँ?';
            }
            results.add(r);
        }
        return results;
    }

    private static String generate(String question) {
        if (String.isBlank(question)) {
            return 'माफ़ कीजिए, मुझे आपका सवाल समझ नहीं आया। क्या आप दोबारा बता सकते हैं?';
        }

        aiplatform.ModelsAPI.createChatGenerations_Request request =
            new aiplatform.ModelsAPI.createChatGenerations_Request();
        request.modelName = MODEL;

        aiplatform.ModelsAPI_ChatGenerationsRequest body =
            new aiplatform.ModelsAPI_ChatGenerationsRequest();

        aiplatform.ModelsAPI_ChatMessageRequest sys = new aiplatform.ModelsAPI_ChatMessageRequest();
        sys.role = 'system';
        sys.content = SYSTEM_PROMPT;

        aiplatform.ModelsAPI_ChatMessageRequest usr = new aiplatform.ModelsAPI_ChatMessageRequest();
        usr.role = 'user';
        usr.content = question;

        body.messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>{ sys, usr };
        request.body = body;

        aiplatform.ModelsAPI modelsApi = new aiplatform.ModelsAPI();
        aiplatform.ModelsAPI.createChatGenerations_Response response =
            modelsApi.createChatGenerations(request);

        if (response != null
                && response.Code200 != null
                && response.Code200.generationDetails != null
                && response.Code200.generationDetails.generations != null
                && !response.Code200.generationDetails.generations.isEmpty()) {
            String content = response.Code200.generationDetails.generations[0].content;
            if (String.isNotBlank(content)) {
                return content;
            }
        }
        return 'माफ़ कीजिए, अभी जवाब उपलब्ध नहीं है।';
    }
}
