# Non-Mermaid Diagram Types (PlantUML & Graphviz)

Verify how v2 handles or gracefully degrades legacy v1 Kroki diagram blocks when external calls are disabled.

## PlantUML Sequence
```plantuml
@startuml
Client -> BrowserEngine : Render Markdown
BrowserEngine -> BrowserEngine : Parse AST + KaTeX + Mermaid
BrowserEngine --> Client : Download PDF
@enduml
```

## Graphviz DOT
```graphviz
digraph G {
  rankdir=LR;
  Markdown -> HTML -> PDF;
}
```
