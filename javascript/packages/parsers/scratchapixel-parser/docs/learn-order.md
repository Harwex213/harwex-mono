# Scratchapixel — reading order

The rule used: a lesson appears only after every lesson it needs. Where a page states its own prerequisites, those statements were followed.

Total: **42 lessons, 165 chapters, ~47 hours** of reading, plus coding time.

---

## Phase 0 — Orientation (192 min)

Read for motivation and vocabulary. Nothing here depends on anything.

| # | Lesson | Time | Why here |
| --- | --- | --- | --- |
| 1 | Your Starting Point! | 28 min | Maps the whole field. Ends with the author's advice to do Geometry next. |
| 2 | 3D Computer Graphics Primer: Ray-Tracing as an Example | 33 min | You get a working renderer on day one. Everything later explains what it does. |
| 3 | What Do I Need to Get Started? | 3 min | Compiler setup. Needed before you can run anything. |
| 4 | Rendering an Image of a 3D Scene | 128 min* | Splits rendering into visibility and shading. That split organises every later lesson. |

\* Step 4 is the outlier at 128 min. It is worth it — it is the conceptual map. Skip it only if you already know the field.

**After Phase 0 you can:** compile and run a ray tracer, and place any technique into the visibility bucket or the shading bucket.

---

## Phase 1 — Maths foundation (203 min)

The author's explicit recommendation, and a hard dependency for everything after.

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 5 | Geometry (12 chapters) | 168 min | — |
| 6 | Matrix Inverse: Gauss-Jordan Method | 16 min | Geometry ch. 4-9 |
| 7 | Placing a Camera: the LookAt Function | 19 min | Geometry: matrices, cross product |

Do not skim chapters 5-7 of Geometry ("How Does Matrix Work" 1 and 2, "Transforming Points and Vectors"). Every later lesson assumes you can read a matrix as a coordinate system.

**After Phase 1 you can:** write your own vector and 4x4 matrix library, transform points, vectors and normals between spaces, invert a matrix, and aim a camera.

---

## Phase 2 — Get pixels onto disk (20 min)

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 8 | Simple Image Manipulations, ch. 1 only — "Reading and Writing Images" | 20 min | — |

Pulled forward out of the Digital Imaging section deliberately. Nothing else on the site gives you a way to save a render. Read chapter 1 now; leave chapters 2 and 3 for Phase 9.

**After Phase 2 you can:** write a PPM file, so every later experiment produces something you can look at.

---

## Phase 3 — Camera and projection (396 min)

This is the visibility half of rendering, taken all the way to the GPU pipeline.

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 9 | Computing the Pixel Coordinates of a 3D Point | 46 min | Geometry (all spaces and matrices) |
| 10 | The Pinhole Camera Model | 78 min | Step 9 |
| 11 | Rasterization | 130 min | Steps 9, 10 |
| 12 | The Perspective and Orthographic Projection Matrix | 142 min | Steps 9-11. Its first chapter names matrices, transforming points, perspective projection and rasterization as required. |

Order note: Rasterization comes before the projection matrix, not after. The projection-matrix lesson states rasterization as a prerequisite, and the site's section order agrees.

**After Phase 3 you can:** write a complete software rasterizer with a z-buffer and perspective-correct interpolation, derive `glFrustum` yourself, and debug a wrong field of view in any engine.

---

## Phase 4 — Ray tracing core (407 min)

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 13 | Overview of the Ray-Tracing Rendering Technique | 48 min | Phase 0 |
| 14 | Generating Camera Rays with Ray-Tracing | 40 min | Geometry, step 9, step 10. Its first chapter lists these explicitly. |
| 15 | A Minimal Ray-Tracer | 55 min | Step 14 |
| 16 | Ray-Tracing: Rendering a Triangle | 86 min | Geometry: dot and cross product |
| 17 | Introduction to Polygon Meshes | 43 min | Step 16 |
| 18 | Ray-Tracing a Polygon Mesh | 31 min | Steps 16, 17 |
| 19 | Transforming Objects using Matrices | 12 min | Geometry, step 6 (inverse), step 18 |
| 20 | Introduction to Acceleration Structures | 92 min | Ray-box test from step 15, meshes from step 18 |

Optional pull-forward: **The OBJ File Format** (29 min, listed at step 40) fits naturally right after step 17. Take it early if you want real models instead of generated spheres. It needs only Introduction to Polygon Meshes.

**After Phase 4 you can:** ray trace transformed meshes at usable speed, cross-check your ray tracer against your rasterizer, and instrument both.

---

## Phase 5 — Colour pipeline (91 min)

Placed before shading on purpose. If you shade before you understand gamma, your images will be wrong and you will not know why.

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 21 | Introduction to Light, Color and Color Space | 50 min | — |
| 22 | Digital Images: from File to Screen | 41 min | Step 21 |

**After Phase 5 you can:** render in linear space, encode to sRGB on output, save HDR images, and convert between colour spaces.

---

## Phase 6 — Shading (262 min)

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 23 | Interpolation | 14 min | Geometry |
| 24 | Introduction to Shading | 121 min | Phase 4, Phase 5 |
| 25 | The Mathematics of Shading | 29 min | Geometry: spherical coordinates |
| 26 | Introduction to Shaders and BRDFs (Phong) | 21 min | Step 24 |
| 27 | A Creative Dive into BRDF, Linearity, and Exposure | 31 min | Steps 25, 26, and Phase 5 |
| 28 | Introduction to Texturing | 46 min | Step 23 (bilinear), step 24, Phase 5 |

Order note: "The Mathematics of Shading" is placed before the radiometry lesson, not before all shading. Basic diffuse shading needs no calculus; radiance and BRDFs do.

Warning on step 28: only chapters 1 and 2 are written. Chapters 3-6 (Texture Filtering, Manipulating Textures, Color Space, Normal Mapping) are stubs, and two of them are empty. Do not wait for them.

Steps 26 and 27 both carry the author's own rewrite notices. Read them for the concepts and the history, not as current practice.

**After Phase 6 you can:** shade a scene with diffuse surfaces, shadows, multiple lights, mirrors, glass and textures, and set exposure deliberately.

---

## Phase 7 — Monte Carlo (334 min)

The single hardest gate on the site. Everything in Phase 8 is blocked behind it. The global-illumination lesson says outright that its content is impossible to follow without this.

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 29 | Mathematical Foundations of Monte Carlo Methods (13 chapters) | 190 min | Step 25 (calculus, solid angle) |
| 30 | Monte Carlo Methods in Practice (7 chapters) | 144 min | Step 29 |

Within step 29, chapter 9 ("Sampling Distribution") and chapter 12 ("Inverse Transform Sampling") carry the most weight for rendering. The author calls chapter 9 the most important one.

**After Phase 7 you can:** derive a Monte Carlo estimator, sample from an arbitrary PDF by inverting its CDF, explain the 1/√N noise law, and apply importance sampling and stratification.

---

## Phase 8 — Advanced light transport (711 min)

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 31 | Value Noise and Procedural Patterns | 77 min | Step 23 (interpolation) |
| 32 | Perlin Noise | 62 min | Step 31 |
| 33 | Introduction to Lighting (9 chapters) | 287 min | Phase 6, Phase 7. Its area-light chapters run on Monte Carlo integration and PDFs. |
| 34 | Global Illumination and Path Tracing | 70 min | Phase 7, step 33, and Geometry ch. 11 (local frame from a normal) |
| 35 | Volume Rendering (7 chapters) | 173 min | Phase 7, step 23 (trilinear), step 32 (noise drives the density field in ch. 4) |
| 36 | Simulating the Colors of the Sky | 42 min | Step 35. The page recommends volume rendering first. |

Noise comes before volume rendering because chapter 4 of the volume lesson builds its density field from a noise function.

**After Phase 8 you can:** write a Monte Carlo path tracer with area lights, soft shadows, indirect diffuse and image-based lighting, validate it with the furnace test, and ray march procedural or simulated volumes and a physical sky.

---

## Phase 9 — Specialisation (220 min)

Nothing here blocks anything else. Take these in any order, by interest.

| # | Lesson | Time | Depends on |
| --- | --- | --- | --- |
| 37 | Bézier Curves and Surfaces | 73 min | Geometry, step 17 (meshes), step 24 (normals) |
| 38 | An Introduction to Fourier Transform | 20 min | Phase 7 helps, not required |
| 39 | Blackbody | 11 min | Step 21 (colour space) — stated on the page |
| 40 | Simple Image Manipulations, ch. 2-3 | 29 min | Step 8 |
| 41 | Tooling: Windowing → The OBJ File Format → Camera Navigation Controls | 24 + 29 + 34 min | OBJ needs step 17. Camera navigation needs step 7 (LookAt) and, in practice, windowing. |

In step 37, chapter 3 ("Fast Forward Differencing") is marked advanced and skippable by the author.

---

## Two shorter routes

### The ray tracer route (~39 hours)

If your goal is a path tracer and you do not care about the GPU pipeline, drop the rasterization and projection-matrix lessons.

Phase 0 → Phase 1 → Phase 2 → step 9 → step 10 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8.

Skip steps 11, 12. Cost: you will not understand what a vertex shader does, and you lose the rasterizer-versus-ray-tracer cross-check in step 18 ch. 2.

### The real-time / GPU route (~20 hours)

If you want to understand what your graphics API is doing.

Phase 0 → Phase 1 → Phase 2 → Phase 3 → step 17 (meshes) → step 23 (interpolation) → step 24 (shading) → Phase 5 → step 28 (texturing) → step 41 (tooling).

Skip Phases 7 and 8 until you need offline quality.

---

## Dependency facts this order is built on

Each of these is stated on the page itself, not inferred:

- **"Your Starting Point!"** → "we strongly suggest you first delve into the lesson on Geometry", then read the beginners' section in order.
- **"Definition of a Ray"** → requires Geometry, and the coordinate systems from "Computing the Pixel Coordinates of a 3D Point".
- **"What Are Projection Matrices"** → requires matrices, transforming points between spaces, perspective projection, and the rasterization algorithm.
- **"An Intuitive Introduction to Global Illumination"** → "If you are unfamiliar with Monte Carlo methods, it will be difficult, if not impossible, to fully understand this lesson."
- **"Area Lights: Mathematical Foundations"** → builds on Monte Carlo integration, PDFs and estimators.
- **"Simulating the Colors of the Sky"** → "We recommend reading the lesson on volume rendering."
- **"Blackbody"** → assumes spectrum rendering, colour conversion and colour space.
- **"The OBJ File Format"** → "I strongly recommend reading the lesson Introduction to Polygon Meshes."
- **"Framing: The LookAt Function"** → requires transformation matrices and the cross product.
- **"Volume Rendering of a 3D Density Field"** → builds its density from a noise function.
- **"Mathematics of Shading"** → "Before you even start to study shading, you first need to be familiar with … geometry and calculus."
