import { Message } from 'ai';
import { convertVercelToLangGraphMessages, createLangGraphClient, LangGraphAdapter } from '@/lib/utils/vercel_langgraph';

// Initialize LangGraph client
const client = createLangGraphClient();

/**
 * POST /api/chat
 * Handles chat messages using LangGraph streaming
 */
export async function POST(request: Request) {
    const {
        id,
        messages
    }: { id: string; messages: Array<Message>; } =
        await request.json();

    try {
        // get default assistant
        const assistants = await client.assistants.search()
        //console.log(assistants)

        let assistant = assistants.find((a) => a.graph_id === 'myAgent')
        if (!assistant) {
            assistant = await client.assistants.create({ graphId: 'myAgent' })
            // throw new Error('No assistant found')
        }

        // create thread
        const thread = await client.threads.create()

        const lastMessage = messages[messages.length - 1];

        const langGraphMessages = convertVercelToLangGraphMessages([lastMessage]);

        const streamResponse = client.runs.stream(
            thread.thread_id,
            assistant.assistant_id,
            {
                input: {
                    messages: langGraphMessages,
                },
                streamMode: "messages-tuple",
                multitask_strategy: "enqueue"
            }
        );

        // Define which nodes to stream from - others will be ignored
        const streamingNodes = ['generate_message'];
        // Return streaming response
        return LangGraphAdapter.toDataStreamResponse(streamResponse, streamingNodes);

    }
}
