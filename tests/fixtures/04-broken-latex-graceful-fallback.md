# Intentionally Broken LaTeX Recovery

This document verifies that malformed LaTeX renders a visible error/fallback instead of hanging or crashing PDF export.

Valid math before error: $\sin^2\theta + \cos^2\theta = 1$.

Unclosed fraction brace:
$$\frac{1}{$$

Unmatched environment and unknown macro:
$$\begin{aligned} x &= \nonexistentmacro{42} \\ y &= \sqrt{unclosed$$

Valid math after error to ensure parser recovers cleanly: $e^{i\pi} + 1 = 0$.
