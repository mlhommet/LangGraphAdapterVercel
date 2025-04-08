import { Message, formatDataStreamPart, generateId } from 'ai';
import { Client } from '@langchain/langgraph-sdk';
import { BaseMessageLike, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';

/**
 * Convert Vercel AI SDK messages to LangChain format
 * @param messages Array of Vercel AI SDK messages
 * @returns Array of LangChain messages
 */
export function convertToLangChainMessages(messages: Message[]): BaseMessageLike[] {
    return messages.map(msg => {
        if (msg.role === 'user') {
            return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
            return new AIMessage(msg.content);
        } else if (msg.role === 'system') {
            return new SystemMessage(msg.content);
        }
        throw new Error(`Unknown message role: ${msg.role}`);
    });
}

/**
 * Converts messages from Vercel AI SDK format to LangGraph format
 * @param messages Array of Vercel AI SDK messages
 * @returns Array of messages in LangGraph format
 */
export function convertVercelToLangGraphMessages(messages: Message[]) {
    return messages.map(msg => ({
        type: msg.role,
        content: msg.content,
    }));
}

/**
 * Creates a LangGraph client with environment configuration
 * Implements a singleton pattern to reuse the same client instance
 * @returns Configured LangGraph client
 */
let langGraphClientInstance: Client | null = null;

export function createLangGraphClient() {
    if (!langGraphClientInstance) {
        langGraphClientInstance = new Client({
            apiUrl: process.env.LANGGRAPH_API_URL || 'http://localhost:2024',
            apiKey: process.env.LANGGRAPH_API_KEY || '',
        });
    }
    return langGraphClientInstance;
}

type LangGraphStreamEvent = {
    event: string;
    data: any;
};

export class LangGraphAdapter {
    private static async* deltaMessagesGenerator(
        streamResponse: AsyncGenerator<{ event: string; data: any; }, any, any>,
        streamingNodes: string[]
    ): AsyncGenerator<string, void, unknown> {
        for await (const message of streamResponse) {
            if (message.event == 'messages' && message.data[1]) {
                const streaming_node = message.data[1]["langgraph_node"];
                const msg = message.data[0];
                if (streamingNodes.includes(streaming_node) && msg?.content) {
                    const current = msg.content;
                    yield formatDataStreamPart('text', current);
                }
            }
        }
    }

    private static async* fullDataStreamGenerator(
        streamResponse: AsyncGenerator<LangGraphStreamEvent, any, any>,
        streamingNodes: string[],
        messageId = generateId(),
    ): AsyncGenerator<string, void, unknown> {
        yield formatDataStreamPart('start_step', { messageId });

        for await (const delta of this.deltaMessagesGenerator(streamResponse, streamingNodes)) {
            yield delta;
        }

        yield formatDataStreamPart('finish_step', {
            finishReason: 'stop',
            usage: { promptTokens: 55, completionTokens: 20 },
            isContinued: false
        });

        yield formatDataStreamPart('finish_message', {
            finishReason: 'stop',
            usage: { promptTokens: 55, completionTokens: 20 }
        });
    }

    private static asyncGeneratorToReadableStream(
        generator: AsyncGenerator<string, any, any>
    ): ReadableStream<string> {
        return new ReadableStream<string>({
            async pull(controller) {
                const { done, value } = await generator.next();
                if (done) {
                    controller.close();
                } else {
                    controller.enqueue(value);
                }
            },
            async cancel(reason) {
                if (generator.return) {
                    await generator.return(reason);
                }
            }
        });
    }

    private static prepareResponseHeaders(
        headers: HeadersInit | undefined,
        {
            contentType,
            dataStreamVersion
        }: { contentType: string; dataStreamVersion?: 'v1' | undefined; }
    ) {
        const responseHeaders = new Headers(headers ?? {});
        if (!responseHeaders.has('Content-Type')) {
            responseHeaders.set('Content-Type', contentType);
        }
        if (dataStreamVersion !== undefined) {
            responseHeaders.set('X-Vercel-AI-Data-Stream', dataStreamVersion);
        }
        return responseHeaders;
    }

    static toDataStreamResponse(
        streamResponse: AsyncGenerator<LangGraphStreamEvent, any, any>,
        streamingNodes: string[]
    ): Response {
        const fullGenerator = this.fullDataStreamGenerator(streamResponse, streamingNodes);
        const readableStream = this.asyncGeneratorToReadableStream(fullGenerator);
        const responseStream = readableStream.pipeThrough(new TextEncoderStream());

        return new Response(responseStream, {
            status: 200,
            statusText: 'OK',
            headers: this.prepareResponseHeaders(
                {},
                {
                    contentType: 'text/plain; charset=utf-8',
                    dataStreamVersion: 'v1'
                }
            )
        });
    }
}