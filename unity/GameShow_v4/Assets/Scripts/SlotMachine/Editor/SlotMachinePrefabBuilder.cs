using System;
using System.Collections.Generic;
using System.Text;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Builds <c>Assets/Prefabs/GoldenLuck_SlotMachine.prefab</c> from the imported FBX and the 2D asset
/// pack. This script is the source of truth for the prefab's layout, not the prefab: rerun
/// <c>GameShow/Slot Machine/Rebuild Prefab</c> after the model is re-exported or a sprite changes,
/// and the whole rig comes back identically.
///
/// Every world position is read from the model's own <c>UI_*_Anchor</c> nodes, so moving a display in
/// Blender moves the 2D layer with it and no number here has to be edited. The only positions
/// written by hand are the ones the model has no anchor for: the reel-bay overlay and the FX.
///
/// Two things about world-space UI on this cabinet are worth knowing before editing this:
///
/// <list type="bullet">
/// <item>The machine's front faces <b>+Z</b>, and an unrotated Canvas is read from <b>-Z</b>. Every
/// canvas is therefore turned 180 degrees about Y. Without that, every number and the logo read
/// mirrored.</item>
/// <item>Because of that turn, canvas-local <b>+X is screen right</b> while world +X is screen left.
/// The reel named Left sits at world x = +0.203 and appears on the viewer's left, which is correct:
/// the FBX axis conversion flips X, and the model's naming follows what a viewer in front sees.</item>
/// </list>
/// </summary>
public static class SlotMachinePrefabBuilder
{
    private const string Art = "Assets/Art/SlotMachine/";
    private const string ModelPath = "Assets/Models/GoldenLuck_SlotMachine.fbx";
    private const string ConfigPath = "Assets/Prefabs/SlotMachine/GoldenLuck_DefaultConfig.asset";
    private const string PrefabPath = "Assets/Prefabs/GoldenLuck_SlotMachine.prefab";
    private const string NumberMaterialPath = "Assets/Art/SlotMachine/Materials/MAT_Reel_Numbers.mat";

    /// <summary>1 canvas unit = 1 mm, so every size in the inspector reads as millimetres.</summary>
    private const float MmToMetres = 0.001f;

    // Display sizes, in millimetres, taken from the UI_*_Surface quads in the model.
    private const float ReelWidth = 156f;
    private const float ReelHeight = 469f;
    private const float LogoWidth = 600f;
    private const float LogoHeight = 126f;
    private const float MedallionSize = 92f;
    private const float ShoeWidth = 570f;
    private const float ShoeHeight = 524f;
    private const float BayWidth = 658f;
    private const float BayHeight = 705f;

    /// <summary>
    /// Where the reel-bay overlay sits. The model has no anchor for it: x and y are the centre of
    /// Frame_ReelBay_Gold, and z is between the reel canvases (0.2185) and the back face of the
    /// display glass (0.2210), so the pointers draw over the reels and the sweep is still seen
    /// through the glass.
    /// </summary>
    private static readonly Vector3 BayCentre = new Vector3(0f, 1.1545f, 0.2205f);

    private static readonly StringBuilder Log = new StringBuilder();
    private static Material _unlit;
    private static Material _additive;
    private static GameObject _model;

    [MenuItem("GameShow/Slot Machine/Rebuild Prefab")]
    public static void Rebuild()
    {
        Log.Clear();
        _unlit = LoadMaterial("MAT_UI_Unlit");
        _additive = LoadMaterial("MAT_UI_Additive");

        var config = AssetDatabase.LoadAssetAtPath<SlotMachineConfig>(ConfigPath);
        var fbx = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
        if (config == null || fbx == null || _unlit == null || _additive == null)
        {
            Debug.LogError("[SlotBuilder] missing an input: config=" + (config != null) + " model=" + (fbx != null) +
                           " unlit=" + (_unlit != null) + " additive=" + (_additive != null));
            return;
        }

        var root = new GameObject("GoldenLuck_SlotMachine");

        try
        {
            BuildModel(root.transform, fbx);

            var ui = Child(root.transform, "UI");
            var logo = BuildLogo(ui);
            var reels = BuildReels(ui, config, out RawImage sweep);
            var medallions = BuildMedallions(ui);
            var shoe = BuildHorseshoeDisplay(ui);

            var fx = BuildFx(root.transform);
            var audio = BuildAudio(root.transform);
            var interaction = BuildInteraction(root.transform);
            Child(root.transform, "Runtime");

            var view = root.AddComponent<SlotMachineView>();
            var effects = fx.gameObject.AddComponent<SlotMachineEffects>();
            var audioRig = audio.gameObject.AddComponent<SlotMachineAudio>();
            var controller = root.AddComponent<SlotMachineController>();
            var input = interaction.gameObject.AddComponent<SlotMachineInput>();

            Wire(view, so =>
            {
                SetArray(so, "reels", reels);
                so.FindProperty("logo").objectReferenceValue = logo[0];
                so.FindProperty("logoGlow").objectReferenceValue = logo[1];
                SetArray(so, "symbolMedallions", medallions);
                so.FindProperty("horseshoe").objectReferenceValue = shoe["Horseshoe"];
                so.FindProperty("horseshoeRadialGlow").objectReferenceValue = shoe["RadialGlow"];
                so.FindProperty("horseshoeInnerGlow").objectReferenceValue = shoe["InnerGlow"];
            });

            Wire(effects, so =>
            {
                so.FindProperty("winFlash").objectReferenceValue = shoe["WinFlash"];
                SetArray(so, "sparkles", new Graphic[] { shoe["Sparkle_0"], shoe["Sparkle_1"] });
                so.FindProperty("lightSweep").objectReferenceValue = sweep;
                so.FindProperty("goldDust").objectReferenceValue = fx.GetComponentInChildren<ParticleSystem>(true);
            });

            Wire(audioRig, so =>
            {
                so.FindProperty("spinSource").objectReferenceValue = audio.Find("SpinSource").GetComponent<AudioSource>();
                so.FindProperty("stopSource").objectReferenceValue = audio.Find("StopSource").GetComponent<AudioSource>();
                so.FindProperty("winSource").objectReferenceValue = audio.Find("WinSource").GetComponent<AudioSource>();
                so.FindProperty("uiSource").objectReferenceValue = audio.Find("UiSource").GetComponent<AudioSource>();
            });

            Wire(controller, so =>
            {
                so.FindProperty("config").objectReferenceValue = config;
                so.FindProperty("view").objectReferenceValue = view;
                so.FindProperty("effects").objectReferenceValue = effects;
                so.FindProperty("audioRig").objectReferenceValue = audioRig;
            });

            Wire(input, so => so.FindProperty("controller").objectReferenceValue = controller);

            // Build the reel cells now, so the prefab ships with them and nothing is created while
            // the game runs.
            Canvas.ForceUpdateCanvases();
            view.Bind(config);

            PrefabUtility.SaveAsPrefabAsset(root, PrefabPath);
        }
        finally
        {
            UnityEngine.Object.DestroyImmediate(root);
        }

        AssetDatabase.SaveAssets();
        Report();
    }

    // ------------------------------------------------------------------ sections

    private static void BuildModel(Transform root, GameObject fbx)
    {
        _model = (GameObject)PrefabUtility.InstantiatePrefab(fbx);
        _model.name = "Model";
        _model.transform.SetParent(root, false);

        // The placeholder quads that mark each display area stay as measurable transforms but must
        // not draw: the 2D layers are what fill those areas.
        int hidden = 0;
        foreach (var r in _model.GetComponentsInChildren<MeshRenderer>(true))
        {
            if (!r.name.StartsWith("UI_") || !r.name.EndsWith("_Surface"))
            {
                continue;
            }

            r.enabled = false;
            hidden++;
        }

        Log.AppendLine("model: " + _model.GetComponentsInChildren<MeshRenderer>(true).Length +
                       " renderers, " + hidden + " UI surface quads hidden");
    }

    private static Image[] BuildLogo(Transform ui)
    {
        var canvas = AnchoredCanvas(ui, "Logo", "UI_Logo_Anchor", LogoWidth, LogoHeight, 0);

        // The marquee band is 4.8:1 and the logo art is 2:1, so Preserve Aspect is what keeps
        // GOLDEN LUCK the right shape. It lands 252 mm wide inside the 600 mm band, which is the
        // proportion the front-view reference paints.
        var logo = AddImage(canvas, "Logo", "Branding/slot_logo_golden_luck.png", _unlit, Color.white, true);
        var glow = AddImage(canvas, "LogoGlow", "Branding/slot_logo_golden_luck_emission.png", _additive, Clear(), true);
        return new[] { logo, glow };
    }

    private static SlotReelController[] BuildReels(Transform ui, SlotMachineConfig config, out RawImage sweep)
    {
        var reelsRoot = Child(ui, "Reels");
        var names = new[] { "Reel_Left", "Reel_Center", "Reel_Right" };
        var anchors = new[] { "UI_Reel_Left_Anchor", "UI_Reel_Center_Anchor", "UI_Reel_Right_Anchor" };

        var reels = new SlotReelController[SlotMachineResult.ReelCount];
        for (int i = 0; i < reels.Length; i++)
        {
            reels[i] = BuildReel(reelsRoot, names[i], anchors[i], i, config);
        }

        sweep = BuildReelBayOverlay(reelsRoot, config);
        return reels;
    }

    private static SlotReelController BuildReel(Transform parent, string name, string anchorName, int index, SlotMachineConfig config)
    {
        var canvas = AnchoredCanvas(parent, name, anchorName, ReelWidth, ReelHeight, 0);
        var strip = config.Reel(index);

        var background = AddImage(canvas, "Background", strip == null ? null : strip.background, _unlit, Color.white, false);

        var viewport = AddRect(canvas, "Viewport", ReelWidth, ReelHeight);
        viewport.gameObject.AddComponent<RectMask2D>();
        var content = AddRect(viewport, "ScrollingContent", ReelWidth, ReelHeight);

        // Layered the way a real reel behind glass reads: barrel shading, then the top and bottom
        // fade, then the warm band on the win line, then the reflection in the glass.
        //
        // Vertical Shading and Edge Shadow are pure black with an alpha ramp, so alpha blending them
        // is exactly a multiply by (1 - alpha). MAT_UI_Multiply would be wrong here: a true multiply
        // ignores alpha and would take the whole reel to black.
        var shading = AddImage(canvas, "VerticalShading", "Reels/Overlays/reel_vertical_shading.png", _unlit, Color.white, false);
        var edge = AddImage(canvas, "EdgeShadow", "Reels/Overlays/reel_edge_shadow.png", _unlit, Color.white, false);
        var highlight = AddImage(canvas, "CenterHighlight", "Reels/Overlays/reel_center_highlight.png", _additive, Alpha(0.16f), false);
        var reflection = AddImage(canvas, "GlassReflection", "Reels/Overlays/reel_glass_reflection.png", _additive, Alpha(0.16f), false);

        var controller = canvas.gameObject.AddComponent<SlotReelController>();
        var reelView = canvas.gameObject.AddComponent<SlotReelView>();

        Wire(reelView, so =>
        {
            so.FindProperty("numberMaterial").objectReferenceValue = NumberMaterial();
            so.FindProperty("viewport").objectReferenceValue = viewport;
            so.FindProperty("scrollingContent").objectReferenceValue = content;
            so.FindProperty("background").objectReferenceValue = background;
            so.FindProperty("centerHighlight").objectReferenceValue = highlight;
            so.FindProperty("edgeShadow").objectReferenceValue = edge;
            so.FindProperty("glassReflection").objectReferenceValue = reflection;
        });

        Wire(controller, so =>
        {
            so.FindProperty("view").objectReferenceValue = reelView;
            so.FindProperty("reelIndex").intValue = index;
        });

        Log.AppendLine("reel " + index + " " + name + " at " + canvas.position.ToString("F4") +
                       " (" + ReelWidth + "x" + ReelHeight + " mm), shading=" + shading.name);
        return controller;
    }

    /// <summary>The four win-line pointers and the light sweep, on one canvas over the whole reel bay.</summary>
    private static RawImage BuildReelBayOverlay(Transform parent, SlotMachineConfig config)
    {
        var canvas = WorldCanvas(parent, "ReelBayOverlay", BayCentre, BayWidth, BayHeight, 10);

        // The win line is the third of four visible positions, so it sits below the reel's middle.
        float cellHeight = ReelHeight / Mathf.Max(1, config.VisibleCells);
        float winLineInReel = ReelHeight * 0.5f - (config.WinLineCell + 0.5f) * cellHeight;
        float reelCentreInBay = (1.0825f - BayCentre.y) * 1000f;
        float markerY = reelCentreInBay + winLineInReel;

        // Canvas-local +X is screen right. The four pointers stand in the gaps between the reel
        // windows and all aim inwards, at the win line, as the front-view reference paints them.
        var xs = new[] { -298f, -101.5f, 101.5f, 298f };
        var sprites = new[] { "marker_left", "marker_left", "marker_right", "marker_right" };
        for (int i = 0; i < xs.Length; i++)
        {
            var marker = AddImage(canvas, "Marker_" + i, "Reels/Markers/" + sprites[i] + ".png", _unlit, Color.white, true);
            var rect = (RectTransform)marker.transform;
            rect.sizeDelta = new Vector2(44f, 44f);
            rect.anchoredPosition = new Vector2(xs[i], markerY);
        }

        var sweep = AddRawImage(canvas, "LightSweep", "FX/light_sweep.png", _additive, Clear(), BayWidth, BayHeight);

        Log.AppendLine("reel bay overlay at " + BayCentre.ToString("F4") + ", cell " + cellHeight.ToString("0.0") +
                       " mm, pointers at y=" + markerY.ToString("0.0") + " mm");
        return sweep;
    }

    private static Image[] BuildMedallions(Transform ui)
    {
        var root = Child(ui, "SymbolMedallions");
        var names = new[] { "Symbol_Left", "Symbol_Center", "Symbol_Right" };
        var anchors = new[] { "UI_Symbol_Left_Anchor", "UI_Symbol_Center_Anchor", "UI_Symbol_Right_Anchor" };
        var sprites = new[] { "Symbols/symbol_star.png", "Symbols/symbol_bell.png", "Symbols/symbol_horseshoe.png" };

        var medallions = new Image[SlotMachineResult.ReelCount];
        for (int i = 0; i < medallions.Length; i++)
        {
            var canvas = AnchoredCanvas(root, names[i], anchors[i], MedallionSize, MedallionSize, 0);
            // The sprite set here is only a default: SlotMachineView replaces it with the first
            // symbol on the matching reel strip, so a reel and its medallion cannot disagree.
            medallions[i] = AddImage(canvas, "Symbol", sprites[i], _unlit, Color.white, true);
        }

        return medallions;
    }

    private static Dictionary<string, Image> BuildHorseshoeDisplay(Transform ui)
    {
        var canvas = AnchoredCanvas(ui, "HorseshoeDisplay", "UI_Horseshoe_Anchor", ShoeWidth, ShoeHeight, 0);
        var layers = new Dictionary<string, Image>();

        layers["Background"] = AddImage(canvas, "Background", "HorseshoePanel/horseshoe_panel_background.png", _unlit, Color.white, false);

        // A RawImage, because the noise is meant to tile and only a RawImage can set a uvRect. Its
        // texture is the reason screen_noise is imported with Repeat and left out of the atlases.
        AddRawImage(canvas, "ScreenNoise", "FX/screen_noise.png", _additive, Alpha(0.35f), ShoeWidth, ShoeHeight)
            .uvRect = new Rect(0f, 0f, 2f, 2f);

        layers["RadialGlow"] = Centred(canvas, "RadialGlow", "HorseshoePanel/horseshoe_radial_glow.png", _additive, Alpha(0.35f), 520f);
        layers["Horseshoe"] = Centred(canvas, "Horseshoe", "HorseshoePanel/horseshoe_main.png", _unlit, Color.white, 320f);
        layers["InnerGlow"] = Centred(canvas, "InnerGlow", "HorseshoePanel/horseshoe_inner_glow.png", _additive, Alpha(0.30f), 340f);

        layers["Sparkle_0"] = Centred(canvas, "Sparkle_0", "HorseshoePanel/sparkle_star.png", _additive, Clear(), 200f);
        Offset(layers["Sparkle_0"], -150f, 90f);
        layers["Sparkle_1"] = Centred(canvas, "Sparkle_1", "HorseshoePanel/sparkle_soft.png", _additive, Clear(), 170f);
        Offset(layers["Sparkle_1"], 160f, -110f);

        layers["WinFlash"] = Centred(canvas, "WinFlash", "FX/win_flash.png", _additive, Clear(), 560f);

        Log.AppendLine("horseshoe display at " + canvas.position.ToString("F4") + " with " + canvas.childCount + " layers");
        return layers;
    }

    private static Transform BuildFx(Transform root)
    {
        var fx = Child(root, "FX");
        var dust = new GameObject("GoldDust");
        dust.transform.SetParent(fx, false);
        // Just in front of the cabinet face, covering the reels and the lower display.
        dust.transform.localPosition = new Vector3(0f, 1.0f, 0.28f);

        var ps = dust.AddComponent<ParticleSystem>();
        ps.Stop();

        var main = ps.main;
        main.duration = 5f;
        main.loop = true;
        main.playOnAwake = false;
        main.startLifetime = 3.2f;
        main.startSpeed = 0.06f;
        main.startSize = new ParticleSystem.MinMaxCurve(0.012f, 0.030f);
        main.gravityModifier = -0.01f;   // the dust drifts up, not down
        main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.maxParticles = 200;
        main.startColor = new ParticleSystem.MinMaxGradient(
            new Color(1f, 0.84f, 0.45f, 1f),
            new Color(1f, 0.95f, 0.72f, 1f));

        var emission = ps.emission;
        emission.enabled = true;
        emission.rateOverTime = 0f;   // SlotMachineEffects turns this up when the machine goes idle

        var shape = ps.shape;
        shape.enabled = true;
        shape.shapeType = ParticleSystemShapeType.Box;
        shape.scale = new Vector3(0.62f, 1.1f, 0.02f);

        var fade = ps.colorOverLifetime;
        fade.enabled = true;
        var gradient = new Gradient();
        gradient.SetKeys(
            new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
            new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(1f, 0.25f), new GradientAlphaKey(0f, 1f) });
        fade.color = new ParticleSystem.MinMaxGradient(gradient);

        var renderer = dust.GetComponent<ParticleSystemRenderer>();
        renderer.material = LoadMaterial("MAT_FX_GoldDust");
        renderer.renderMode = ParticleSystemRenderMode.Billboard;
        renderer.sortingOrder = 5;
        renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        renderer.receiveShadows = false;

        Log.AppendLine("gold dust at " + dust.transform.localPosition.ToString("F3") + ", emission off until idle");
        return fx;
    }

    private static Transform BuildAudio(Transform root)
    {
        var audio = Child(root, "Audio");
        // Positioned 3D sources, so the machine is heard where it stands rather than in the middle of
        // the mix. Every clip is optional and lives on the config.
        AddSource(audio, "SpinSource", 1.05f, true);
        AddSource(audio, "StopSource", 1.05f, false);
        AddSource(audio, "WinSource", 0.55f, false);
        AddSource(audio, "UiSource", 1.30f, false);
        return audio;
    }

    private static void AddSource(Transform parent, string name, float height, bool loop)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        go.transform.localPosition = new Vector3(0f, height, 0.15f);

        var source = go.AddComponent<AudioSource>();
        source.playOnAwake = false;
        source.loop = loop;
        source.spatialBlend = 0.85f;
        source.rolloffMode = AudioRolloffMode.Linear;
        source.minDistance = 1.2f;
        source.maxDistance = 14f;
        source.dopplerLevel = 0f;
    }

    private static Transform BuildInteraction(Transform root)
    {
        var interaction = Child(root, "Interaction");

        var colliderGo = new GameObject("InteractionCollider");
        colliderGo.transform.SetParent(interaction, false);
        var box = colliderGo.AddComponent<BoxCollider>();
        // One box around the cabinet body, deliberately ignoring the plinth overhang and every bevel.
        // This is what a host or a raycast hits, not a physics shell. Nothing on the UI canvases is a
        // raycast target and no canvas carries a Graphic Raycaster, so it cannot block UI input.
        box.center = new Vector3(0f, 0.90f, -0.007f);
        box.size = new Vector3(0.814f, 1.80f, 0.466f);

        // Where a host or a player stands to work the machine, facing it.
        var point = new GameObject("InteractionPoint");
        point.transform.SetParent(interaction, false);
        point.transform.localPosition = new Vector3(0f, 0f, 0.75f);
        point.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);

        Log.AppendLine("interaction box centre=" + box.center.ToString("F3") + " size=" + box.size.ToString("F3"));
        return interaction;
    }

    // ------------------------------------------------------------------ primitives

    private static Transform Child(Transform parent, string name)
    {
        var go = new GameObject(name);
        go.transform.SetParent(parent, false);
        return go.transform;
    }

    /// <summary>A world-space canvas sitting on one of the model's UI anchors.</summary>
    private static RectTransform AnchoredCanvas(Transform parent, string name, string anchorName, float w, float h, int sortingOrder)
    {
        var anchor = FindInModel(anchorName);
        if (anchor == null)
        {
            Debug.LogError("[SlotBuilder] the model has no anchor named " + anchorName);
            return null;
        }

        return WorldCanvas(parent, name, anchor.position, w, h, sortingOrder);
    }

    private static RectTransform WorldCanvas(Transform parent, string name, Vector3 worldPosition, float w, float h, int sortingOrder)
    {
        var go = new GameObject(name, typeof(Canvas));
        var rect = (RectTransform)go.transform;
        rect.SetParent(parent, false);

        var canvas = go.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.WorldSpace;
        // One small canvas per display, so a reel rebuilding its text never dirties the logo or the
        // lower panel. Override Sorting makes the layer order explicit instead of leaving it to how
        // the bounds centres happen to sort.
        canvas.overrideSorting = true;
        canvas.sortingOrder = sortingOrder;

        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = new Vector2(w, h);
        rect.position = worldPosition;
        rect.localRotation = Quaternion.Euler(0f, 180f, 0f);
        rect.localScale = new Vector3(MmToMetres, MmToMetres, MmToMetres);
        return rect;
    }

    private static RectTransform AddRect(Transform parent, string name, float w, float h)
    {
        var go = new GameObject(name, typeof(RectTransform));
        var rect = (RectTransform)go.transform;
        rect.SetParent(parent, false);
        Fill(rect, w, h);
        return rect;
    }

    private static void Fill(RectTransform rect, float w, float h)
    {
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.pivot = new Vector2(0.5f, 0.5f);
        rect.anchoredPosition = Vector2.zero;
        rect.sizeDelta = new Vector2(w, h);
        rect.localScale = Vector3.one;
        rect.localRotation = Quaternion.identity;
    }

    private static Image AddImage(Transform parent, string name, string spritePath, Material material, Color color, bool preserveAspect)
    {
        return AddImage(parent, name, LoadSprite(spritePath), material, color, preserveAspect);
    }

    private static Image AddImage(Transform parent, string name, Sprite sprite, Material material, Color color, bool preserveAspect)
    {
        var go = new GameObject(name, typeof(RectTransform));
        go.transform.SetParent(parent, false);

        var image = go.AddComponent<Image>();
        image.sprite = sprite;
        image.material = material;
        image.color = color;
        image.preserveAspect = preserveAspect;
        image.raycastTarget = false;

        var parentRect = (RectTransform)parent;
        Fill((RectTransform)go.transform, parentRect.sizeDelta.x, parentRect.sizeDelta.y);
        return image;
    }

    private static RawImage AddRawImage(Transform parent, string name, string texturePath, Material material, Color color, float w, float h)
    {
        var go = new GameObject(name, typeof(RectTransform));
        go.transform.SetParent(parent, false);

        var raw = go.AddComponent<RawImage>();
        raw.texture = AssetDatabase.LoadAssetAtPath<Texture2D>(Art + texturePath);
        raw.material = material;
        raw.color = color;
        raw.raycastTarget = false;
        Fill((RectTransform)go.transform, w, h);
        return raw;
    }

    private static Image Centred(Transform parent, string name, string spritePath, Material material, Color color, float size)
    {
        var image = AddImage(parent, name, spritePath, material, color, true);
        ((RectTransform)image.transform).sizeDelta = new Vector2(size, size);
        return image;
    }

    private static void Offset(Image image, float x, float y)
    {
        ((RectTransform)image.transform).anchoredPosition = new Vector2(x, y);
    }

    private static Color Alpha(float a)
    {
        return new Color(1f, 1f, 1f, a);
    }

    private static Color Clear()
    {
        return new Color(1f, 1f, 1f, 0f);
    }

    private static Transform FindInModel(string name)
    {
        foreach (var t in _model.GetComponentsInChildren<Transform>(true))
        {
            if (t.name == name)
            {
                return t;
            }
        }

        return null;
    }

    private static Sprite LoadSprite(string relative)
    {
        var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(Art + relative);
        if (sprite == null)
        {
            Debug.LogError("[SlotBuilder] missing sprite " + Art + relative);
        }

        return sprite;
    }

    /// <summary>
    /// The one TextMeshPro material every reel number uses. It is derived from the default font's own
    /// material, so it keeps that font's atlas, and adds the dark rim the cabinet reference paints.
    /// Sharing a single material is what keeps all eighteen cells in one batch; letting TMP create a
    /// material per text would make eighteen copies of it.
    /// </summary>
    private static Material NumberMaterial()
    {
        var existing = AssetDatabase.LoadAssetAtPath<Material>(NumberMaterialPath);
        if (existing != null)
        {
            return existing;
        }

        var font = TMPro.TMP_Settings.defaultFontAsset;
        if (font == null)
        {
            Debug.LogWarning("[SlotBuilder] no default TMP font asset, so the numbers get no rim.");
            return null;
        }

        var material = new Material(font.material);
        material.name = "MAT_Reel_Numbers";
        material.SetFloat("_OutlineWidth", 0.16f);
        material.SetColor("_OutlineColor", new Color(0.16f, 0.09f, 0.02f, 1f));
        material.SetFloat("_FaceDilate", 0.08f);
        AssetDatabase.CreateAsset(material, NumberMaterialPath);
        return material;
    }

    private static Material LoadMaterial(string name)
    {
        var mat = AssetDatabase.LoadAssetAtPath<Material>(Art + "Materials/" + name + ".mat");
        if (mat == null)
        {
            Debug.LogError("[SlotBuilder] missing material " + name);
        }

        return mat;
    }

    /// <summary>
    /// Assigns private serialized fields. Direct assignment is not available from outside the
    /// component, and this is the route that also writes arrays and nested serializable classes.
    /// </summary>
    private static void Wire(UnityEngine.Object target, Action<SerializedObject> assign)
    {
        var so = new SerializedObject(target);
        assign(so);
        so.ApplyModifiedPropertiesWithoutUndo();
    }

    private static void SetArray(SerializedObject so, string name, UnityEngine.Object[] values)
    {
        var prop = so.FindProperty(name);
        prop.arraySize = values.Length;
        for (int i = 0; i < values.Length; i++)
        {
            prop.GetArrayElementAtIndex(i).objectReferenceValue = values[i];
        }
    }

    private static void Report()
    {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
        if (prefab == null)
        {
            Debug.LogError("[SlotBuilder] the prefab was not saved.\n" + Log);
            return;
        }

        Log.AppendLine("saved " + PrefabPath);
        Log.AppendLine("transforms=" + prefab.GetComponentsInChildren<Transform>(true).Length +
                       " graphics=" + prefab.GetComponentsInChildren<Graphic>(true).Length +
                       " canvases=" + prefab.GetComponentsInChildren<Canvas>(true).Length +
                       " masks=" + prefab.GetComponentsInChildren<RectMask2D>(true).Length +
                       " colliders=" + prefab.GetComponentsInChildren<Collider>(true).Length +
                       " audioSources=" + prefab.GetComponentsInChildren<AudioSource>(true).Length);

        foreach (var view in prefab.GetComponentsInChildren<SlotReelView>(true))
        {
            Log.AppendLine("  " + view.name + ": cells=" + view.CellCount +
                           " cellHeight=" + view.CellHeight.ToString("0.0") + " mm" +
                           " winLineOffset=" + view.WinLineOffset.ToString("0.0") + " mm");
        }

        var problems = prefab.GetComponent<SlotMachineController>().Validate();
        Log.AppendLine("validate: " + (problems.Count == 0 ? "clean" : string.Join(" | ", problems)));

        Debug.Log("[SlotBuilder]\n" + Log);
    }
}
