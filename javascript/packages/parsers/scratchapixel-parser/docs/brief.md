# Scratchapixel — what every page teaches you

---

## Section 1 — The Foundations of 3D Rendering

### Lesson: 3D Computer Graphics Primer: Ray-Tracing as an Example

`lessons/3d-basic-rendering/introduction-to-ray-tracing/`

**1. How Does it Work — 8 min**
Learn: an image is a slice through a pyramid whose apex is the eye. Rendering splits into two steps: project outlines, then colour them in. Photons are absorbed, reflected or transmitted, and the counts must add up. Materials split into conductors and dielectrics.
Do: explain to anyone how a 3D scene becomes a 2D picture, and name which of the two steps a given technique belongs to.

**2. The Raytracing Algorithm in a Nutshell — 8 min**
Learn: forward tracing shoots rays from the light and almost all of them miss the eye. Backward tracing shoots from the eye instead, so every ray counts.
Do: justify why renderers trace rays from the camera, not from the light.

**3. Implementing the Raytracing Algorithm — 5 min**
Learn: the loop over pixels, the primary ray, the nearest-hit search, the `trace` function.
Do: write the skeleton of a ray tracer, with the intersection routines still stubbed out.

**4. Adding Reflection and Refraction — 6 min**
Learn: Whitted's 1979 extension. A hit on a mirror or on glass spawns new rays, so the algorithm becomes recursive.
Do: add mirror and glass materials to a ray tracer by recursion.

**5. Writing a Basic Raytracer — 6 min**
Learn: a complete ~300-line C++ ray tracer, explained piece by piece.
Do: compile it, render your first image, and change the scene. You have a working renderer on day one.

### Lesson: What Do I Need to Get Started?

`lessons/3d-basic-rendering/prerequesites/`

**1. Setting Things Up! — 3 min**
Learn: why the site uses C++, what hardware you need, and which compiler to install on Windows, macOS or Linux.
Do: compile and run any program on the site with a single command line.

### Lesson: Your Starting Point!

`lessons/3d-basic-rendering/get-started/`

**1. A Gentle Introduction to Computer Graphics (Programming) — 28 min**
Learn: the scope of the field, how a virtual world is described as numbers, how an image of it is made, and why geometry comes first. Ends with the author's own advice on where to start.
Do: pick your route through the site, and hold a conversation using the field's vocabulary.

### Lesson: Rendering an Image of a 3D Scene

`lessons/3d-basic-rendering/rendering-3d-scene-overview/`

**1. It All Starts with a Computer and a Computer Screen — 10 min**
Learn: computers store discrete data, but the shapes we want are continuous. A raster image is a grid of pixels.
Do: reason about where discretisation happens in your pipeline, and why that causes artefacts.

**2. And It Follows with a 3D Scene — 16 min**
Learn: how objects are represented, why the triangle became the rendering primitive, and that a scene is more than geometry — it also holds a camera, lights and materials.
Do: describe a scene in the exact terms a renderer needs as input.

**3. An Overview of the Rendering Process: Visibility and Shading — 11 min**
Learn: rendering splits into the visibility problem and the shading problem. Photorealism is defined and then broken down.
Do: sort any rendering technique you meet into the visibility bucket or the shading bucket.

**4. Perspective Projection — 9 min**
Learn: the projection step at overview level, and where the projection matrix fits.
Do: state clearly how a 3D point turns into a 2D position.

**5. The Visibility Problem — 21 min**
Learn: rasterization loops over triangles, ray tracing loops over pixels. Both solve hidden-surface removal, with different costs.
Do: choose between the two methods for a given problem and defend the choice.

**6. A Light Simulator — 19 min**
Learn: the catalogue of real light effects — mirror reflection, transparency, glossy highlights, diffuse, subsurface scattering, indirect diffuse, caustics, soft shadows — and what global illumination means.
Do: look at a photograph, name the effect you see, and say which algorithm can reproduce it.

**7. Light Transport — 20 min**
Learn: a light path is the sequence of materials a ray meets on the way to the eye. Light transport algorithms are named and separated from ray tracing itself.
Do: read a renderer's feature list and tell the visibility part from the light transport part.

**8. Shading — 17 min**
Learn: why some effects are simulated by light transport and others are faked by shading. Brightness of illumination is separated from brightness of colour.
Do: understand what a shader is actually asked to compute.

**9. Summary and Other Considerations About Rendering — 5 min**
Learn: a compact recap of the lesson's terms and concepts.
Do: self-check your vocabulary before moving on.

### Lesson: Computing the Pixel Coordinates of a 3D Point

`lessons/3d-basic-rendering/computing-pixel-coordinates-of-3d-point/`

**1. Perspective Projection — 7 min**
Learn: the question "how do I find the 2D pixel coordinates of a 3D point?", a refresher on perspective projection, and some history.
Do: state the goal of the whole vertex pipeline in one sentence.

**2. Mathematics of Computing the 2D Coordinates of a 3D Point — 39 min**
Learn: the full chain of spaces — world, camera, screen, NDC, raster — the world-to-camera matrix, and a 4x4 matrix read as a coordinate system. Includes code and exercises.
Do: write a program that projects a model's vertices and outputs a wireframe. Convert a point between any two spaces without guessing.

### Lesson: The Pinhole Camera Model

`lessons/3d-basic-rendering/3d-viewing-pinhole-camera/`

**1. How a pinhole camera works (part 1) — 16 min**
Learn: the camera obscura, how a real camera forms an image, and what the pinhole idealises away.
Do: reason about aperture, sharpness and depth of field in physical terms.

**2. How a pinhole camera works (part 2) — 20 min**
Learn: focal length, angle of view, film size, image resolution, frame aspect ratio, and how the film gate relates to the canvas.
Do: compute field of view from focal length and film back, and match a real lens with your virtual camera.

**3. A Virtual Pinhole Camera Model — 21 min**
Learn: how cameras are represented in CG, near and far clipping planes, the viewing frustum, canvas size, and the camera-to-world matrix.
Do: define a virtual camera with the same controls a photographer uses.

**4. Implementing a Virtual Pinhole Camera — 21 min**
Learn: intrinsic and extrinsic parameters, the long and the quick way to canvas coordinates, and the fit modes when resolution gate and film gate disagree.
Do: write a camera class that reproduces a Maya camera, then verify your render against a reference image.

### Lesson: Rasterization

`lessons/3d-basic-rendering/rasterization-practical-implementation/`

**1. An Overview of the Rasterization Algorithm — 20 min**
Learn: the algorithm end to end, the bounding-box optimisation, the frame buffer, and why a depth buffer is needed.
Do: sketch a complete rasterizer before writing a line of it.

**2. The Projection Stage — 14 min**
Learn: screen space is three-dimensional, the z-coordinate must be kept, and how to remap screen coordinates to NDC and then to raster space.
Do: transform vertices into pixel coordinates with depth preserved.

**3. The Rasterization Stage — 42 min**
Learn: the edge function, why vertex winding matters, barycentric coordinates, interpolation versus extrapolation, and the fill rules that stop cracks and double-shading.
Do: implement a correct pixel-in-triangle test with production fill rules.

**4. The Visibility Problem, the Depth Buffer Algorithm and Depth Interpolation — 21 min**
Learn: the z-buffer, why you interpolate 1/z rather than z, depth precision limits, and the older visible-surface algorithms.
Do: implement hidden-surface removal, and diagnose z-fighting.

**5. Perspective Correct Interpolation and Vertex Attributes — 18 min**
Learn: why naive interpolation of UVs across a triangle is wrong, and the divide that fixes it.
Do: interpolate texture coordinates, colours and normals correctly.

**6. Rasterization: a Practical Implementation — 15 min**
Learn: aliasing and anti-aliasing, rendering in pixel blocks, optimising the edge function, and fixed-point coordinates.
Do: finish a complete triangle rasterizer, and explain what a GPU does inside.

### Lesson: The Perspective and Orthographic Projection Matrix

`lessons/3d-basic-rendering/perspective-and-orthographic-projection-matrix/`

**1. What Are Projection Matrices and Where/Why Are They Used? — 14 min**
Learn: what a projection matrix does, where it sits in the pipeline, and how the perspective and orthographic versions differ.
Do: decide whether you need a projection matrix at all — ray tracing usually does not.

**2. Projection Matrices: What You Need to Know First — 17 min**
Learn: the canonical viewing volume, clipping, and homogeneous coordinates with the w-divide.
Do: read any projection-matrix derivation without getting lost.

**3. Building a Basic Perspective Projection Matrix — 21 min**
Learn: how to remap the z-coordinate and fold the field of view into the matrix, built from first principles.
Do: derive your own projection matrix instead of copying one.

**4. The Perspective Projection Matrix — 22 min**
Learn: the OpenGL matrix derived term by term, the `[-1,1]` versus `[0,1]` depth range question, and depth-buffer precision problems.
Do: write `glFrustum` yourself, and port a matrix between OpenGL, Direct3D, Vulkan and Metal conventions.

**5. Lost? Let's Recap With Real-World Production Examples — 39 min**
Learn: computing angle of view, the journey of one vertex down the pipe, non-square canvases, the near plane, fit modes, and vertical versus horizontal field of view.
Do: debug a wrong field of view or a stretched image in a real engine.

**6. About the Projection Matrix, the GPU Rendering Pipeline and Clipping — 18 min**
Learn: clip space, the old fixed-function vertex pipeline, the modern programmable one, and how the GPU runs it fast.
Do: write the MVP chain in a vertex shader and know exactly what each stage does.

**7. The Orthographic Projection Matrix — 11 min**
Learn: what orthographic projection is for, and how its matrix is built.
Do: render blueprints, sprites, shadow maps and CAD views.

### Lesson: Overview of the Ray-Tracing Rendering Technique

`lessons/3d-basic-rendering/ray-tracing-overview/`

**1. Overview of the Ray-Tracing Rendering Technique — 27 min**
Learn: ray tracing computes visibility between points and nothing more. Covers casting rays, intersection tests, the trace function, shading, the performance challenges, and ray tracing on the GPU.
Do: keep visibility and light transport separate in your architecture — the mistake most beginners make.

**2. Light Transport Algorithms and Ray-Tracing: Whitted Ray-Tracing — 21 min**
Learn: the Whitted algorithm, recursion, trees of rays, and its limits. Includes a C++ implementation.
Do: implement a Whitted ray tracer with mirrors, glass and hard shadows.

### Lesson: Generating Camera Rays with Ray-Tracing

`lessons/3d-basic-rendering/ray-tracing-generating-camera-rays/`

**1. Definition of a Ray — 10 min**
Learn: a ray is an origin plus a direction, plus the parametric form. Also what rays are used for beyond primary visibility.
Do: define the ray type your whole renderer will be built on.

**2. Generating Camera Rays — 22 min**
Learn: the walk from pixel index to NDC, to screen, to camera space, to a world-space direction, with source code.
Do: write the primary-ray generator — half of any ray tracer.

**3. Standard Coordinate Systems — 8 min**
Learn: OpenGL and RenderMan name the same spaces differently, and where that bites.
Do: read other people's code and papers without mixing up space names.

### Lesson: A Minimal Ray-Tracer

`lessons/3d-basic-rendering/minimal-ray-tracer-rendering-simple-shapes/`

**1. Parametric and Implicit Surfaces — 12 min**
Learn: the two ways to define a surface, why both suit ray tracing, and how derivatives give you tangents and normals.
Do: turn a surface equation into an intersection routine.

**2. Ray-Sphere Intersection — 18 min**
Learn: the geometric and the analytic solution, plus the hit point, the normal and the texture coordinates. With C++.
Do: ray trace spheres robustly, including the numerical traps.

**3. A Minimal Ray-Tracer: Rendering Spheres — 11 min**
Learn: a complete program that renders a sphere scene from any viewpoint, walked through feature by feature.
Do: render your own sphere scenes with camera transforms.

**4. Ray-Plane and Ray-Disk Intersection — 4 min**
Learn: both tests follow from one dot product being zero.
Do: add ground planes and disks to your scene.

**5. Ray-Box Intersection — 10 min**
Learn: the slab method for an axis-aligned box, and how to optimise it.
Do: intersect AABBs — the routine every acceleration structure depends on.

### Lesson: Ray-Tracing: Rendering a Triangle

`lessons/3d-basic-rendering/ray-tracing-rendering-a-triangle/`

**1. Why Are Triangles Useful? — 8 min**
Learn: what a geometric primitive is, and why the triangle won.
Do: understand why every mesh you meet is triangulated.

**2. Geometry of a Triangle — 9 min**
Learn: computing a plane normal by cross product, and how handedness affects the result.
Do: get normals and orientation right before writing any intersection test.

**3. Ray-Triangle Intersection: Geometric Solution — 16 min**
Learn: hit the plane, then run the inside-outside test. Includes the parallel case and the behind-the-ray case.
Do: write a ray-triangle test you fully understand.

**4. Single vs Double Sided Triangle and Backface Culling — 6 min**
Learn: what winding order means for visibility, and when to cull back faces.
Do: fix models that render inside out or vanish.

**5. Barycentric Coordinates — 23 min**
Learn: what barycentric coordinates are, how to compute them, what else they are used for, and how to optimise them.
Do: interpolate any vertex attribute at a hit point — normals, UVs, colours.

**6. Möller-Trumbore algorithm — 24 min**
Learn: the 1997 fast test derived through Cramer's rule, with implementation and notes.
Do: use the intersection routine that production renderers use.

### Lesson: Introduction to Polygon Meshes

`lessons/3d-basic-rendering/introduction-polygon-mesh/`

**1. Introduction to Polygon Meshes — 26 min**
Learn: face and vertex arrays, primitive variables, vertex normals, and texture coordinates — how mesh data is actually laid out in memory.
Do: design your own mesh class, and read any engine's mesh structures.

**2. File Formats to Store Polygon Meshes: OBJ, FBX, RenderMan, glTF, USD, etc. — 17 min**
Learn: how the common formats store the same information, and what each adds.
Do: choose a format for your tool, and know what you lose in a conversion.

### Lesson: Ray-Tracing a Polygon Mesh

`lessons/3d-basic-rendering/ray-tracing-polygon-mesh/`

**1. From Polygon to Triangle Mesh — 12 min**
Learn: how to triangulate arbitrary polygons and carry normals and UVs across.
Do: convert any mesh into the triangle form your intersector needs.

**2. Ray-Tracing a Polygon Mesh (Part 1) — 10 min**
Learn: loop over triangles, keep the nearest hit, and see how badly the cost scales.
Do: ray trace a real model, and measure why you will need an acceleration structure.

**3. Ray-Tracing a Polygon Mesh (Part 2) — 9 min**
Learn: the same scene rendered by ray tracing and by rasterization, compared pixel by pixel.
Do: cross-validate two renderers against each other — the best correctness test you have.

### Lesson: Transforming Objects using Matrices

`lessons/3d-basic-rendering/transforming-objects-using-matrices/`

**1. Using 4x4 Matrices to Transform Objects in 3D — 12 min**
Learn: transforming vertices, transforming normals with the inverse transpose, and the ray-tracing trick of moving the ray into object space instead of moving the object.
Do: place, rotate and scale objects in a scene, and ray trace instanced geometry cheaply.

### Lesson: Introduction to Shading

`lessons/3d-basic-rendering/introduction-to-shading/`

**1. What is Shading: Light-Matter interaction — 14 min**
Learn: what shading is, and the four vectors every shader uses — N, P, L, V. Sets the terminology.
Do: read any shading formula and know what each symbol is.

**2. Normals, Vertex Normals and Facing Ratio — 11 min**
Learn: why normals drive appearance, the facing-ratio effect, and flat versus smooth shading via vertex normals.
Do: render your first shaded image, and make a faceted mesh look smooth.

**3. Lights — 10 min**
Learn: distant lights, spherical lights, light intensity and light colour, at introductory level.
Do: put working lights in your renderer.

**4. Diffuse and Lambertian Shading — 22 min**
Learn: how light interacts with a diffuse surface, and where the cosine law comes from.
Do: implement the diffuse term that every renderer starts with.

**5. Light and Shadows — 9 min**
Learn: shadow rays, the optimisations they allow, and shadow acne caused by self-intersection.
Do: cast correct shadows and fix the black speckles with a bias.

**6. Spherical Light — 11 min**
Learn: point-like spherical lights with distance falloff, and the shadows they cast.
Do: light a scene with lamps rather than an abstract direction.

**7. Multiple Lights — 4 min**
Learn: light response is linear, so contributions simply add.
Do: sum any number of lights, and know why that is physically valid.

**8. Reflection, Refraction and Fresnel — 29 min**
Learn: the reflection direction, Snell's law for refraction, total internal reflection, the Fresnel effect, and the conductor versus dielectric distinction. With implementation.
Do: write believable glass, water and metal.

**9. Procedural Texturing — 11 min**
Learn: how a pattern can be computed from surface coordinates, plus the aliasing it causes.
Do: add checkerboards and stripes with no texture files, and see aliasing appear.

### Lesson: Introduction to Shaders and BRDFs

`lessons/3d-basic-rendering/phong-shader-BRDF/`

**1. The Phong Model and the concepts of Illumination Models and BRDF — 21 min**
Learn: the Phong model, what an illumination model is, the BRDF concept, specular and diffuse lobes, and why Phong fell out of favour. The author flags the page as due for a rewrite.
Do: write a Phong shader, and read modern BRDF papers with the right vocabulary.

### Lesson: A Creative Dive into BRDF, Linearity, and Exposure

`lessons/3d-basic-rendering/brdf-linear-exposure/`

**1. An Introduction for Artists to BRDFs and Radiometry — 16 min**
Learn: what a BRDF is, the radiometric quantities — flux, irradiance, radiance — the basic equations, and the diffuse BRDF with its 1/π.
Do: use radiometric units correctly, and stop guessing at energy conservation.

**2. Controlling CG Lighting: Exposure, Grey Zone, and Grey Balls — 13 min**
Learn: albedo, the 0.18 middle-grey number, stops of exposure, and how a grey ball on set is used to match lighting.
Do: think in stops, set exposure deliberately, and match a CG render to a live-action plate.

**3. Painting Textures — 2 min**
Learn: a short note on what to keep out of a painted texture, since lighting will add it.
Do: author albedo maps that do not fight your renderer.

### Lesson: Introduction to Lighting

`lessons/3d-basic-rendering/introduction-to-lighting/`

**1. An Introduction to Lighting in 3D Rendering — 41 min**
Learn: the shadow test, delta lights versus area lights, light linearity, radiance versus irradiance, intensity and colour, dynamic range, colour temperature, and how CG lights map to real ones.
Do: design a light system with physical units instead of magic multipliers.

**2. Point and Spot Lights — 27 min**
Learn: the point light and the inverse-square law, the sphere light, and the spot light's cone falloff. Heavy on code.
Do: implement the punctual lights every renderer ships.

**3. Distant Lights — 9 min**
Learn: the sun as a direction with no falloff, its implementation, and its remaining place in modern rendering.
Do: add a sun light, the simplest one to get working.

**4. Area Lights: Mathematical Foundations — 56 min**
Learn: why area lights are the physically right model, a friendly introduction to Monte Carlo integration, the rendering equation, hemisphere versus area sampling, PDFs, estimators, and sampling strategies.
Do: understand the maths behind every soft shadow you will ever render.

**5. Triangular Area Light — 51 min**
Learn: how to sample a triangle uniformly, through six methods — naive, trilinear, square-root, Kraemer, rejection, low-distortion — with their trade-offs and full implementation.
Do: sample any triangle light correctly, and recognise a broken sampling scheme by its noise.

**6. Rectangular Area Light — 6 min**
Learn: the quad area light and its sampling.
Do: add the softbox light that lighting artists reach for first.

**7. Spherical Area Light: Using Area Sampling — 40 min**
Learn: uniform sampling of a sphere, sampling a non-uniform PDF, a full `SphereLight` implementation, and why area sampling wastes samples here.
Do: implement a sphere light, and see measured noise confirm a theoretical weakness.

**8. Spherical Area Light: Using Cone Sampling — 42 min**
Learn: sampling only the cone the light subtends, in two steps — direction first, then position.
Do: cut sphere-light noise dramatically with the method production renderers use.

**9. Direct Lighting: The Light Loop — 15 min**
Learn: how direct lighting sums over all lights, and how importance sampling handles many lights.
Do: write a scalable direct-lighting loop for scenes with hundreds of lights.

### Lesson: Introduction to Texturing

`lessons/3d-basic-rendering/introduction-to-texturing/`

**1. Introduction to Texturing — 7 min**
Learn: what texturing adds beyond uniform colours, and which shader parameters can be textured.
Do: plan which maps a material needs.

**2. Basic Implementation — 35 min**
Learn: the data you need, the render loop, the texture lookup, and bilinear filtering. A full working implementation.
Do: texture-map a mesh from UVs, with nearest and bilinear sampling.

**3. Texture Filtering — 1 min — STUB**
Learn: only an outline survives, with aliasing, mip-maps and filters named but not explained.
Do: nothing from this page — read a mip-mapping reference elsewhere.

**4. Manipulating Textures — 1 min — STUB**
Learn: two sentences noting that UVs can be scaled and translated for tiling and clamping.
Do: nothing from this page.

**5. Color Space — 1 min — STUB**
Learn: the page is empty. The Digital Imaging section covers the topic properly.
Do: read `digital-imaging/colors/` instead.

**6. Normal Mapping — 1 min — STUB**
Learn: the page is empty.
Do: read an external normal-mapping reference.

### Lesson: Introduction to Acceleration Structures

`lessons/3d-basic-rendering/introduction-acceleration-structure/`

**1. Introduction — 7 min**
Learn: why a brute-force ray tracer dies on real geometry, and how to instrument the renderer with ray statistics.
Do: measure ray-triangle test counts, so later speedups are provable and not felt.

**2. Bounding Volume — 8 min**
Learn: the cheapest possible win — reject a whole object with one box test.
Do: cut render times with a few lines of code.

**3. Bounding Volume Hierarchy: BVH (part 1) — 15 min**
Learn: Kay and Kajiya's plane-set extents and the ray-volume test they enable.
Do: build tighter bounds than an axis-aligned box gives you.

**4. Bounding Volume Hierarchy: BVH (part 2) — 20 min**
Learn: how the volumes are grouped into a hierarchy, and how a ray descends it.
Do: implement a BVH — the structure in every modern ray tracer and in RTX hardware.

**5. Grid — 37 min**
Learn: uniform space subdivision, the 3D digital differential analyser that walks the ray cell by cell, mail-boxing, and further optimisations.
Do: implement a grid, and compare it against your BVH on real scenes.

**6. What Else? — 5 min**
Learn: what makes an acceleration structure good, the pros and cons of the main families, and where real-time ray tracing is heading.
Do: choose a structure for your workload instead of copying one.

### Lesson: Global Illumination and Path Tracing

`lessons/3d-basic-rendering/global-illumination-path-tracing/`

**1. An Intuitive Introduction to Global Illumination and Path Tracing — 34 min**
Learn: what global illumination is, how backward tracing simulates indirect diffuse light, why the same approach is poor for indirect specular, and why caustics are the hard case.
Do: explain the strengths and the failure modes of a path tracer before you write one.

**2. Global Illumination and Path Tracing: a Practical Implementation — 36 min**
Learn: building a local frame around the shading normal, generating hemisphere samples, transforming them, tracing indirect rays, and combining the result. Plus the furnace test, what unbiased means, image-based lighting, and why the image is noisy.
Do: write a Monte Carlo path tracer with indirect diffuse and environment lighting, then prove it is energy-correct with the furnace test.

### Lesson: Volume Rendering

`lessons/3d-basic-rendering/volume-rendering-for-developers/`

**1. An Introduction to Volume Rendering — 22 min**
Learn: internal transmittance, absorption, particle density, Beer's law, scattering, and in-scattering.
Do: render a uniform volume sphere over a background, and add a light to it.

**2. The Ray-Marching Algorithm — 19 min**
Learn: forward and backward ray marching, why forward is preferred, and how to choose a step size.
Do: implement ray marching, the workhorse of volume rendering.

**3. Ray Marching: Getting it Right! — 28 min**
Learn: the four interaction terms, the density term, the phase function, jittering to kill banding, and early exit when the volume turns opaque.
Do: get a physically correct volume instead of a plausible-looking one, and read other people's volume code.

**4. Volume Rendering of a 3D Density Field — 26 min**
Learn: driving density with a noise function, and shaping the look with smoothstep, fBm and bias.
Do: render procedural smoke and clouds, and animate them.

**5. Volume Rendering Based On 3D Voxel Grids — 33 min**
Learn: storing density in a grid, marching through it, interpolating lookups, and the production concerns — OpenVDB, brick maps, sparse volumes, motion blur, advection, out-of-core.
Do: render simulation data from fluid software, and read an OpenVDB-based renderer.

**6. From the Radiative Transfer Equation to the Volume Rendering Equation — 37 min**
Learn: the absorption, scattering and extinction coefficients, the derivation of Beer-Lambert, optical depth, the phase function, and the path from the radiative transfer equation to code.
Do: follow volume rendering papers, and map each term in an equation to a line in your loop.

**7. What's Next? Stochastic Method for Monte Carlo — 8 min**
Learn: single versus multiple scattering, low versus high albedo volumes, and the tracking methods that replaced ray marching in modern engines.
Do: know what to study next, and why your ray marcher is a generation behind production.

---

## Section 2 — Mathematics for Computer Graphics

The author positions this section as a reference to consult, not a place to start. The Geometry lesson is the exception — the "Your Starting Point!" page recommends it first.

### Lesson: Geometry

`lessons/mathematics-physics-for-computer-graphics/geometry/`

**1. Points, Vectors and Normals — 15 min**
Learn: what linear algebra is for here, how a point differs from a vector, what a normal is, and the C++ classes for all three.
Do: write the vector type your whole renderer will use.

**2. Coordinate Systems — 25 min**
Learn: Cartesian systems in 2D and 3D, left-handed versus right-handed, and the world coordinate system.
Do: fix the handedness bugs that mirror or invert your scenes.

**3. Math Operations on Points and Vectors — 12 min**
Learn: length, normalisation, dot product, cross product, and addition and subtraction, with a C++ class.
Do: implement the five operations that make up most graphics code.

**4. Matrices — 9 min**
Learn: why matrices exist here, what they contain, and how multiplication works.
Do: multiply matrices, and read a matrix without fear.

**5. How Does Matrix Work: Part 1 — 20 min**
Learn: the identity, scaling, rotation and translation matrices, how rotations combine, and rotation about an arbitrary axis.
Do: build any transformation matrix from scratch.

**6. How Does Matrix Work: Part 2 — 11 min**
Learn: a matrix read as a coordinate system, orthogonal matrices, and affine transformations.
Do: look at a matrix and see the axes and origin it encodes — the single most useful skill here.

**7. Transforming Points and Vectors — 16 min**
Learn: why 4x4 and not 4x3, what homogeneous coordinates really are, and why vectors and normals transform differently from points.
Do: transform anything between spaces correctly.

**8. Row Major vs Column Major Vectors and Matrices — 28 min**
Learn: both conventions, how they change multiplication order, which APIs use which, and why the cache-locality argument is a myth.
Do: port matrix code between engines and maths libraries without transposing by trial and error.

**9. Matrix Operations — 2 min**
Learn: transpose, inverse and determinant, briefly.
Do: recognise the three operations when you meet them.

**10. Spherical Coordinates and Trigonometric Functions — 13 min**
Learn: representing a direction by two angles, the conversions both ways, and the shortcuts that avoid trig calls.
Do: sample directions on a sphere and a hemisphere — required for shading and Monte Carlo.

**11. Creating an Orientation Matrix or Local Coordinate System — 7 min**
Learn: how to build a frame around an arbitrary normal vector.
Do: write the helper that path tracing and area-light sampling both need.

**12. Transforming Normals — 10 min**
Learn: why non-uniform scaling breaks normals, and why the inverse transpose fixes it, with the proof.
Do: keep lighting correct on scaled objects.

### Lesson: Matrix Inverse: Gauss-Jordan Method

`lessons/mathematics-physics-for-computer-graphics/matrix-inverse/`

**1. Matrix Inverse — 16 min**
Learn: the Gauss-Jordan method step by step, and the shortcut that an orthogonal matrix inverts by transposition.
Do: invert any 4x4 matrix, which you need for every world-to-camera and world-to-object transform.

### Lesson: Interpolation

`lessons/mathematics-physics-for-computer-graphics/interpolation/`

**1. Introduction — 3 min**
Learn: why data on a grid must be read at arbitrary positions.
Do: recognise interpolation as the same problem across textures, volumes and animation.

**2. Bilinear Filtering — 5 min**
Learn: interpolating a value inside a cell of a 2D grid.
Do: sample a texture smoothly instead of blockily.

**3. Trilinear Interpolation — 6 min**
Learn: the 3D extension, as two bilinear interpolations blended.
Do: read voxel grids and 3D noise smoothly.

### Lesson: Placing a Camera: the LookAt Function

`lessons/mathematics-physics-for-computer-graphics/lookat-function/`

**1. Framing: The LookAt Function — 19 min**
Learn: how to build a camera-to-world matrix from an eye point, a target and an up vector, and where the method fails.
Do: aim a camera in one call, convert between camera-to-world and world-to-camera, and handle the degenerate up vector.

### Lesson: The Mathematics of Shading

`lessons/mathematics-physics-for-computer-graphics/mathematics-of-shading/`

**1. Mathematics of Shading — 29 min**
Learn: spherical coordinates, solid angle, and an intuitive introduction to differential and integral calculus, aimed at rendering.
Do: read the rendering equation and shading papers without stalling on the notation.

### Lesson: Mathematical Foundations of Monte Carlo Methods

`lessons/mathematics-physics-for-computer-graphics/monte-carlo-methods-mathematical-foundations/`

**1. A Quick Introduction to Monte Carlo Methods — 23 min**
Learn: what a Monte Carlo method is, and how biased and unbiased ray tracing differ.
Do: see why the rest of this lesson is unavoidable.

**2. Random Variables and Probability — 13 min**
Learn: sample space, random variable, probability, and the terminology.
Do: state a rendering problem in probabilistic terms.

**3. Probability Distribution: Part 1 — 11 min**
Learn: what a distribution is, with two worked examples.
Do: reason about which values your samples take, and how often.

**4. Probability Properties — 9 min**
Learn: mutually exclusive and collectively exhaustive events, independence, and the basic rules.
Do: combine probabilities correctly.

**5. Introduction to Statistics — 6 min**
Learn: population versus sample, and why the distinction matters.
Do: read your render as a sample of an unknown true image.

**6. Expected Value — 25 min**
Learn: the mean, the expected value, and the properties of expectation.
Do: use linearity of expectation, the algebra behind every estimator.

**7. Variance and Standard Deviation — 9 min**
Learn: how spread is measured, and the properties of variance.
Do: quantify render noise instead of describing it.

**8. Probability Distribution: Part 2 — 3 min**
Learn: the normal distribution and its equation.
Do: recognise the Gaussian when it shows up in filters and in the central limit theorem.

**9. Sampling Distribution — 34 min**
Learn: the distribution of a statistic, the properties of the sample mean, and the bean-machine experiment. The author calls this the most important chapter.
Do: explain why noise falls as 1/√N, and why quadrupling samples only halves the noise.

**10. Probability Density Function (PDF) and Cumulative Distribution Function (CDF) — 12 min**
Learn: what a PDF and a CDF are, and how they relate.
Do: read the `pdf` term in any rendering formula and know what it weights.

**11. Expected Value of the Function of a Random Variable — 7 min**
Learn: the law of the unconscious statistician.
Do: take the expected value of a shading function, the key step in deriving the estimator.

**12. The Inverse Transform Sampling Method — 24 min**
Learn: how inverting the CDF turns uniform random numbers into samples of any distribution, with the CDFs of well-known PDFs.
Do: sample cosine-weighted hemispheres, triangles and spheres, deriving the formulas yourself.

**13. Estimators — 14 min**
Learn: estimate versus estimator, biased versus unbiased, and the properties that matter.
Do: judge whether a rendering technique converges to the right answer.

### Lesson: Monte Carlo Methods in Practice

`lessons/mathematics-physics-for-computer-graphics/monte-carlo-methods-in-practice/`

**1. Monte Carlo Methods — 15 min**
Learn: the methods themselves, including the hit-or-miss method, and why they are used.
Do: solve a problem by random sampling.

**2. Monte Carlo Simulation — 44 min**
Learn: a full neutron-transport simulation, built from scratch. The same structure as light transport in a volume.
Do: write a physical simulation by random walk — the mental model behind volumetric path tracing.

**3. Monte Carlo Integration — 14 min**
Learn: the estimator for an integral, generalised to an arbitrary PDF, its properties, and why it beats deterministic quadrature in high dimensions.
Do: integrate anything, including the rendering equation.

**4. Monte Carlo in Rendering (A Practical Example) — 13 min**
Learn: rendering a Macbeth chart by integrating over wavelengths, and progressive rendering.
Do: build a spectral renderer, and display an image that refines while it computes.

**5. Generating Random Numbers — 12 min**
Learn: tables, true random sources, pseudo-random generators, and the C++11 `<random>` library.
Do: choose an RNG that does not put patterns in your image.

**6. Variance Reduction Methods: a Quick Introduction to Importance Sampling — 21 min**
Learn: why sampling where the function is large reduces variance, with a worked example.
Do: apply importance sampling — the single biggest noise win available to you.

**7. Variance Reduction Methods: a Quick Introduction to Quasi Monte Carlo — 25 min**
Learn: stratified sampling, low-discrepancy sequences, the Van der Corput sequence, and the trade-offs.
Do: replace pure random samples with better-distributed ones and converge faster.

### Lesson: An Introduction to Fourier Transform

`lessons/mathematics-physics-for-computer-graphics/fourier-transform/`

**1. Introduction to Fourier Transform — 20 min**
Learn: decomposing a signal into frequencies, the complex numbers needed, a C++11 DFT, and the extension from 1D signals to 2D images.
Do: write a DFT, inspect the frequency content of noise and sampling patterns, and reason about aliasing with evidence.

---

## Section 3 — Computer Graphics Gems

### Lesson: Blackbody

`lessons/cg-gems/blackbody/`

**1. Understanding blackbody radiation — 11 min**
Learn: the spectrum of a blackbody, Planck's law, the Stefan-Boltzmann law, and the Planckian locus in chromaticity space.
Do: turn a colour temperature in Kelvin into a physically correct RGB colour, and light scenes with real lamp temperatures. Requires the colour-space lesson first.

---

## Section 4 — Geometry

### Lesson: Bézier Curves and Surfaces

`lessons/geometry/bezier-curve-rendering-utah-teapot/`

**1. Bézier Curve — 18 min**
Learn: the story of Newell's teapot, the Bézier curve and its basis matrix, the de Casteljau algorithm, the properties of these curves, and how to join and split them.
Do: evaluate and draw Bézier curves, and understand every curve editor you have used.

**2. Bézier Surfaces — 9 min**
Learn: extending a curve to a 4x4 patch, and tessellating that patch into triangles.
Do: render the Utah teapot from its original patch data.

**3. Fast Forward Differencing — 27 min**
Learn: Taylor series and forward differencing used to evaluate a curve with additions only. The author marks this chapter as advanced and skippable.
Do: tessellate patches much faster, and pick up a general optimisation technique.

**4. Calculating Normals of Bézier Surfaces — 7 min**
Learn: taking partial derivatives of a patch and crossing them to get the normal.
Do: shade patch geometry correctly.

**5. Rendering Curves as Geometry: Hair Rendering — 12 min**
Learn: sweeping a loop of vertices along a curve, using a local frame, and meshing the result.
Do: build hair, fur and cable geometry from curves.

---

## Section 5 — Digital Imaging

### Lesson: Introduction to Light, Color and Color Space

`lessons/digital-imaging/colors/`

**1. Introduction — 20 min**
Learn: what light is, how the eye works, additive versus subtractive primaries, lightness, spectral power distribution, what white means, and the power of light.
Do: talk about colour physically, and stop treating RGB as if it were the colour itself.

**2. Color Space — 30 min**
Learn: what a colour space is, CIE XYZ and xyY, RGB spaces, the XYZ-to-RGB conversion, the Macbeth chart exercise, and a note on ACES.
Do: convert between colour spaces, and convert a spectral render into displayable RGB.

### Lesson: Digital Images: from File to Screen

`lessons/digital-imaging/digital-images/`

**1. Displaying Images to the Screen — 13 min**
Learn: linear colour space, human brightness adaptation, display gamma, gamma encoding, and sRGB.
Do: render in linear space and encode correctly on output. This is the fix for renders that look washed out or too dark.

**2. Creating, Saving and Reading Digital Images — 28 min**
Learn: which number formats suit images, quantisation, encoding gamma, the PPM format, high dynamic range images, compression, the alpha channel, and why a pixel is a sample and not a little square.
Do: write PPM and HDR files, and choose bit depth and format deliberately.

### Lesson: Simple Image Manipulations

`lessons/digital-imaging/simple-image-manipulations/`

**1. Reading and Writing Images (A Simple Image Class) — 20 min**
Learn: the PPM format and a small `Image` class with an `Rgb` pixel type. Code-heavy.
Do: save every render from here on. Read this early — nothing else outputs a file for you.

**2. Simple Image Manipulations — 17 min**
Learn: extending the image class with per-pixel and neighbourhood operations.
Do: build a small image-processing library of your own.

**3. Example 1: Simulating the Bokeh Effect in 2D — 12 min**
Learn: what bokeh is, and how to fake it in 2D from bright spots and a sprite.
Do: add a convincing photographic effect in post, without rendering depth of field.

---

## Section 6 — Procedural Generation of Virtual Worlds

### Lesson: Value Noise and Procedural Patterns

`lessons/procedural-generation-virtual-worlds/procedural-patterns-noise-part-1/`

**1. Introduction — 17 min**
Learn: the history of procedural noise, what procedural texturing buys you, the trade-offs, and the properties an ideal noise function must have.
Do: judge a noise function instead of copying one.

**2. Creating a Simple 1D Noise — 26 min**
Learn: cosine and smoothstep interpolation, a complete 1D noise function, scaling, offsetting, and signed noise.
Do: write a working noise function and control its frequency and amplitude.

**3. Creating a Simple 2D Noise — 15 min**
Learn: extending noise to 2D and beyond, and the permutation table trick.
Do: generate 2D and 3D noise with a fixed, small memory footprint.

**4. Simple Pattern Examples — 19 min**
Learn: fractal sum, turbulence, marble and wood, built from the noise primitive.
Do: author procedural textures — marble, wood, clouds, rust — with no image files.

### Lesson: Perlin Noise

`lessons/procedural-generation-virtual-worlds/perlin-noise-part-2/`

**1. Perlin Noise — 21 min**
Learn: gradient noise, how to distribute gradients uniformly, and why it beats value noise.
Do: implement the noise function that most of the industry actually uses.

**2. Using Perlin Noise to Create a Terrain Mesh — 7 min**
Learn: displacing a grid mesh by a 2D noise lookup.
Do: generate terrain, your first piece of procedural world.

**3. Computing Derivatives — 20 min**
Learn: partial derivatives, the analytical derivatives of Perlin noise, and how they compare to forward differences.
Do: get exact normals and slopes from noise for free, without finite differences.

**4. Improved Perlin Noise — 14 min**
Learn: why the original interpolant and gradient choice are flawed, and Perlin's 2002 fixes.
Do: ship the improved version and avoid its predecessor's visible artefacts.

### Lesson: Simulating the Colors of the Sky

`lessons/procedural-generation-virtual-worlds/simulating-sky/`

**1. Simulating the Colors of the Sky — 42 min**
Learn: the atmospheric model, Rayleigh and Mie scattering, optical depth, adding sunlight, the sky colour computation, a C++ implementation, light shafts, aerial perspective, and alien skies.
Do: render a physically based sky at any time of day, plus god rays and atmospheric haze. Builds directly on volume rendering.

---

## Section 7 — Tooling

### Lesson: Windowing

`lessons/3d-basic-rendering/windowing/`

**1. Universal Aspects of Window Systems — 8 min**
Learn: what every window system has in common — the event loop, the message queue, the surface you draw into.
Do: understand any windowing API you pick up next.

**2. Creating a Window on Windows OS — 16 min**
Learn: a ~200-line WinAPI program — creating the window, handling events, and blitting a bitmap. Very code-heavy.
Do: show your render in a live window, and draw with the mouse. Windows only.

### Lesson: The OBJ File Format

`lessons/3d-basic-rendering/obj-file-format/`

**1. Learn reading 3D model data from OBJ format files — 29 min**
Learn: the OBJ format, its history, a full parser, and how to test it. Very code-heavy.
Do: load real models from disk and render them, instead of hard-coding geometry.

### Lesson: Camera Navigation Controls

`lessons/3d-basic-rendering/cam-nav-controls/`

**1. Navigating a 3D Scene with Mouse and Keyboard — 34 min**
Learn: Maya-style tumble, dolly and track, driven by mouse deltas, with the full code listing.
Do: add interactive navigation and turn your renderer into a viewer you can explore.

---

## Site pages (not lessons)

**`index.html`** — the catalogue of all lessons in seven sections. It is also the reading-order hint the author gives: within a section, lessons are listed in the intended order. Announces the blog, a Vulkan course and the book.

**`book-project.html`** — the status of the printed book. Started at the end of 2025, paused, restarted in spring 2026 after a donor covered printing for the first 200 copies. First results are targeted before the end of 2026.

**`about-us.html`** — the site's mission: CG programming for people without a research background. Also how to support the project.

**`terms-of-service.html`** — the content is for personal, non-commercial use. Lessons are published under CC BY-NC-ND 4.0.

---

## Notes on the state of the material

- **Four stub chapters.** Texture Filtering, Manipulating Textures, Color Space and Normal Mapping in the texturing lesson are unwritten. Two are literally empty. Plan around them.
- **Two lessons are flagged as dated by the author.** "Introduction to Shaders and BRDFs" (Phong) and "A Creative Dive into BRDF, Linearity, and Exposure" both carry rewrite notices. The information is still usable, but production practice has moved on.
- **The material is C++ throughout.** Every program compiles standalone with one command, with no external dependencies.
- **Depth is uneven by design.** The introductory chapters run 5-10 minutes. The area-light, sampling and volume-rendering chapters run 40-56 minutes each and carry the real weight.
