# Level 4: Code (key interfaces)

<!-- c4-auto-start: code -->
### Core types (lib/)

```mermaid
classDiagram
    class AgentStatus {
        <<enumeration>>
        running
        waiting
        done
        blocked
        stalled
        terminated
        unknown
    }

    class AgentRecord {
        +id: string
        +name: string
        +pid: number
        +cwd: string
        +model: string
        +startedAt: number
        +heartbeat: number
        +status: AgentStatus
        +task?: string
        +pendingMessages?: number
        +sessionDir?: string
        +sessionFile?: string
    }

    class DeliveryResult {
        +accepted: boolean
        +immediate: boolean
        +reference?: string
        +error?: string
    }

    class InboundMessage {
        +id: string
        +from: string
        +text: string
        +ts: number
    }

    class MessageTransport {
        <<interface>>
        +send(peer, from, msg) Promise~DeliveryResult~
        +receive(agentId) InboundMessage[]
        +ack(agentId, msgId) void
        +prune(agentId) void
        +init(agentId) void
        +pendingCount(agentId) number
        +cleanup(agentId) void
    }

    class MaildirTransport {
        +send(peer, from, msg) Promise~DeliveryResult~
        +receive(agentId) InboundMessage[]
        +ack(agentId, msgId) void
        +prune(agentId) void
        +init(agentId) void
        +pendingCount(agentId) number
        +cleanup(agentId) void
    }

    AgentRecord --> AgentStatus
    MessageTransport --> DeliveryResult : returns
    MessageTransport --> InboundMessage : returns
    MessageTransport --> AgentRecord : receives peer
    MessageTransport <|.. MaildirTransport : implements
```

### Extension modules (pi-panopticon/)

```mermaid
classDiagram
    class Registry {
        <<interface>>
        +selfId: string
        +getRecord() Readonly~AgentRecord~ | undefined
        +register(ctx: ExtensionContext) void
        +unregister() void
        +setStatus(status: AgentStatus) void
        +updateModel(model: string) void
        +setTask(task: string) void
        +setName(name: string) void
        +updatePendingMessages(count: number) void
        +readAllPeers() AgentRecord[]
        +flush() void
    }

    class RegistryImpl {
        -record: AgentRecord | undefined
        -heartbeatTimer: Timer | null
        +selfId: string
        +register(ctx) void
        +unregister() void
        +setStatus(status) void
        +updateModel(model) void
        +setTask(task) void
        +setName(name) void
        +updatePendingMessages(count) void
        +flush() void
        +readAllPeers() AgentRecord[]
        -heartbeat() void
    }

    class MessagingModule {
        <<interface>>
        +init() void
        +drainInbox() void
        +dispose() void
    }

    class SpawnerModule {
        <<interface>>
        +shutdownAll() Promise~void~
    }

    class UIModule {
        <<interface>>
        +start(ctx: ExtensionContext) void
        +stop() void
        +refresh(ctx: ExtensionContext) void
    }

    class Orchestrator {
        <<index.ts>>
        -registry: RegistryImpl
        -messaging: MessagingModule
        -spawner: SpawnerModule
        -ui: UIModule
    }

    Registry <|.. RegistryImpl : implements
    RegistryImpl --> "1" AgentRecord : holds (self)
    RegistryImpl --> "0..*" AgentRecord : reads (peers)

    Orchestrator --> RegistryImpl
    Orchestrator --> MessagingModule
    Orchestrator --> SpawnerModule
    Orchestrator --> UIModule

    MessagingModule --> Registry : getRecord, readAllPeers, updatePendingMessages
    MessagingModule --> MessageTransport : send, receive, ack, init, prune, pendingCount, cleanup
    UIModule --> Registry : readAllPeers, getRecord, setName
```

### Dependency direction

```mermaid
graph TD
    subgraph "pi-panopticon extension"
        id_10[index]
        id_11[registry]
        id_12[messaging]
        id_13[spawner]
        id_14[peek]
        id_15[ui]
        id_16[types]
    end

    subgraph "lib"
        id_17[agent-registry]
        id_18[message-transport]
        id_19[transports/maildir]
        id_20[session-log]
        id_21[tool-result]
    end

    id_10 --> id_11
    id_10 --> id_12
    id_10 --> id_13
    id_10 --> id_15
    id_12 --> id_11
    id_12 --> id_18
    id_12 --> id_17
    id_14 --> id_11
    id_14 --> id_20
    id_15 --> id_11
    id_15 --> id_20
    id_11 --> id_17
    id_19 --> id_18
    id_19 --> id_17
    id_16 --> id_17
    id_16 --> id_21
```
<!-- c4-auto-end: code -->
