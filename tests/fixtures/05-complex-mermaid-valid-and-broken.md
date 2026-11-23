# Complex Mermaid + Broken Syntax Isolation

## 1. Complex Flowchart with Subgraphs & Styling
```mermaid
flowchart TB
    subgraph Client["Browser (Client Render v2)"]
        A[CodeMirror Editor] --> B{Parser Pipeline}
        B -->|Math| C[KaTeX Local]
        B -->|Diagrams| D[Mermaid Local]
        B -->|Tables| E[Auto-Scale / Landscape]
    end
    subgraph Output["Print Engine"]
        C & D & E --> F[Print Stylesheet]
        F --> G([Save as PDF])
    end
```

## 2. Sequence Diagram with Loops & Alt Blocks
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Editor
    participant Renderer
    User->>Editor: Paste ChatGPT Markdown
    loop Debounce 150ms
        Editor->>Renderer: AST + Math + SVG Diagrams
    end
    alt Valid Syntax
        Renderer-->>User: Live Preview + Instant PDF
    else Syntax Error
        Renderer-->>User: Inline Error Callout (Non-blocking)
    end
```

## 3. Intentionally Broken Mermaid Block (Must Not Break Diagrams 1 & 2)
```mermaid
graph TD
    A[Start] --->|broken arrow syntax| ???
    B((Unclosed node
    subgraph
```
