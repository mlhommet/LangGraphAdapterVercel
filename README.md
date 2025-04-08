# langgraphAdaptorVercel
LangGraph Adaptor for Next.js & Vercel AI SDK 4
inspired by @Robert Shimizu's code shared on langgraph slack community channel

Shows how to create a next.js Server Route that connects to a LangGraph server
The nodes to stream from are passed to the langgraph invocation (as far as I know, this has to be done client-side, there are no mechanism on Langgraph side to specify which nodes are streamable or not).
