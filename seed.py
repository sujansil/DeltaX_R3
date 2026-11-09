"""Editable starting content transcribed from the supplied Project Helios finale paper.
Check the final mathematical wording with the question authors before event day.
"""
SHARED = '''## The shared physical setting

A satellite operates in a circular, zero-eclipse Sun-synchronous orbit under a strict Nadir-pointing orientation. Its +Y axis continuously faces Earth; active solar tracking is disabled.

:: S(t) = [cos(ωt), (1/√2) sin(ωt), (1/√2) sin(ωt)]ᵀ

The orbital period is T = 2π/ω.

Before deployment, every satellite component and folded panel must fit strictly inside a semi-elliptical launch shroud:

:: x²/36 + y²/25 ≤ 1,  y ≥ 0,  z ∈ [0, 4]

All answers must include mathematical working and intermediate steps. Use the answer booklet provided.''' 

A_CONTENT = '''## A1 · Volumetric bounds & packaging — 30 marks

**(a) 15 marks.** Derive the exact dimensions x₀ and y₀ of the rectangular satellite core base 2x₀ × y₀, centered at x = 0, that maximizes cross-sectional area inside the upper semi-ellipse.

:: x²/36 + y²/25 ≤ 1

**(b) 15 marks.** Prove analytically that mounting additional folded panel layers outside this optimal core box strictly violates the nosecone boundary. Compute the maximum deployable surface area Aₜₒₜₐₗ obtained by flush vertical side panels along height z₀ = 4.

## A2 · Orbit flux & angle optimization — 40 marks

Four planar panels of equal area A are deployed into a fixed pyramidal geometry with tilt angle α ∈ [0, π/2] relative to the +Y Nadir axis and azimuth angles φᵢ ∈ {0, π/2, π, 3π/2}.

**(a) 20 marks.** Express the dynamic dot product S(t) · nᵢ for each panel and derive the orbit-integrated power in closed form.

:: P(α) = η ∫₀ᵀ ∑ᵢ₌₁⁴ A max(0, S(t) · nᵢ) dt

**(b) 20 marks.** Rigorously prove using calculus that the fixed tilt angle maximizing the net integrated power is α* = π/2 (90°).

## A3 · Shadowing & gradient discontinuities — 30 marks

**(a) 15 marks.** For two panel hinges separated by displacement Δr = [Δx, Δy, Δz]ᵀ, derive the exact orbital phase angle interval ωt ∈ (θ₁, θ₂) within [0, 2π] during which Panel 1 casts a geometric shadow onto Panel 2.

:: S(t) · Δr < 0

**(b) 15 marks.** Explain mathematically why introducing step-function shadow indicators V(t) ∈ {0, 1} creates zero-gradient plateaus (∇α P = 0), causing standard gradient descent algorithms to fail.'''

B_CONTENT = '''## B1 · Parametric packaging & algebraic constants — 30 marks

A deployable solar array consists of a two-segment hinged wing with equal link lengths (L₁ = L₂ = L). Segment 1 deploys at primary angle θ₁ ∈ [0, π/2] relative to +X, while Segment 2 deploys at relative angle θ₂ = 2θ₁.

**(a) 15 marks.** Express the wing-tip coordinates rₜᵢₚ = [xₜᵢₚ, yₜᵢₚ]ᵀ as a function of θ₁ for a satellite core width of 2x₀ = 4.

**(b) 15 marks.** Prove that when θ₁ = π/6 (30°), the maximum allowable segment length L that touches the semi-elliptical envelope simplifies to the following exact algebraic constant:

:: L = 1220√3 / 399 ≈ 5.296 units

:: x²/36 + y²/25 = 1

## B2 · Coupled analytical integration — 40 marks

**(a) 20 marks.** Derive the unit normal vectors n₁(θ₁) and n₂(θ₁) in the XY-plane for both array segments.

**(b) 20 marks.** Evaluate the total orbit-integrated illumination flux over one full orbit period T = 2π/ω.

:: I(θ₁) = ∫₀ᵀ [max(0, S(t) · n₁) + max(0, S(t) · n₂)] dt

Prove that the integral simplifies to the closed-form function:

:: I(θ₁) = (2/ω) [√(1 − ½ cos²θ₁) + √(1 − ½ cos²(3θ₁))]

## B3 · Stationary-point optimization — 30 marks

**(a) 20 marks.** Determine the optimal primary angle θ₁* ∈ [0, π/2] that maximizes I(θ₁). Prove whether θ₁* is an interior stationary point (dI/dθ₁ = 0) or a boundary point using first and second derivatives.

**(b) 10 marks.** Formulate a surrogate-modeling strategy (e.g. Gaussian Process Regression or Particle Swarm Optimization) for configurations with non-differentiable shadow step-functions.'''

QUESTIONS = {
 'A': {'title': 'Project Helios I', 'subtitle': 'Spatial geometry & pyramid projections', 'blurb': 'Build within the boundary. Extract the greatest possible light.', 'content': A_CONTENT},
 'B': {'title': 'Project Helios II', 'subtitle': 'Coupled dynamic kinematics', 'blurb': 'Two linked movements. One optimal configuration.', 'content': B_CONTENT},
}
