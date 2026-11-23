# Nested Markdown Formatting + Math

Bold and italic wrappers around math:
- **Energy-mass equivalence: $E = mc^2$**
- *Schrödinger equation: $i\hbar \frac{\partial}{\partial t}\Psi(\mathbf{r},t) = \hat{H}\Psi(\mathbf{r},t)$*
- ***Combined bold-italic: $\oint_{\partial \Sigma} \mathbf{B} \cdot d\boldsymbol{\ell} = \mu_0 I_{\text{enc}}$***

Nested bullet and numbered lists with block math:
1. **First Principle**
   - Sub-item with inline matrix $\begin{pmatrix} a & b \\ c & d \end{pmatrix}$
   - Sub-item with display math inside list indentation:
     $$\det(A - \lambda I) = 0$$
2. **Blockquote with Math**
   > For any normal subgroup $N \trianglelefteq G$, the quotient group $G/N$ satisfies $\vert{}G/N\vert{} = \frac{\vert{}G\vert{}}{\vert{}N\vert{}}$.
