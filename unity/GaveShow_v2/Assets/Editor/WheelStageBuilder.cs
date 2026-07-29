using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace GameShow.EditorTools
{
    /// <summary>
    /// Rebuilds the prize-wheel stage scene from the FBX files exported out of
    /// Assets/Art/Source~/wheel_stage.blend.
    ///
    /// Every number here is derived from the Blender scene. Blender is Z-up and
    /// right-handed, Unity is Y-up and left-handed, so positions convert as
    /// unity = (-bx, bz, -by). Directions convert the same way, which is why the
    /// light and camera aims below are stored as forward/up vector pairs instead
    /// of Euler angles.
    ///
    /// The builder is re-runnable: it overwrites the materials, the LED texture
    /// and the scene in place, so re-exporting from Blender and running this
    /// again is the whole round trip.
    /// </summary>
    public static class WheelStageBuilder
    {
        const string k_ModelDir = "Assets/Models";
        const string k_MaterialDir = "Assets/Models/Materials";
        const string k_TextureDir = "Assets/Art/Textures";
        const string k_SceneDir = "Assets/Scenes";
        const string k_ScenePath = k_SceneDir + "/WheelStage.unity";
        const string k_ProfilePath = "Assets/Settings/WheelStage_Volume.asset";
        const string k_LedTexPath = k_TextureDir + "/TEX_LED_Cyclorama.png";

        // Aim point the moving heads and washes converge on: the wheel hub.
        static readonly Vector3 k_WheelHub = new Vector3(0f, 3.5f, -1.2f);

        [MenuItem("GameShow/Build Wheel Stage Scene")]
        public static void Build()
        {
            EnsureFolders();
            EnsurePipelineFeatures();
            EnsureLedTexture();
            var materials = BuildMaterials();
            ConfigureModelImporters();
            BuildScene(materials);
            AssetDatabase.SaveAssets();
            Debug.Log("[WheelStageBuilder] Built " + k_ScenePath);
        }

        // ------------------------------------------------------------------
        // folders
        // ------------------------------------------------------------------

        static void EnsureFolders()
        {
            string[] dirs = { k_MaterialDir, k_TextureDir, k_SceneDir };
            foreach (var d in dirs)
            {
                if (!AssetDatabase.IsValidFolder(d))
                {
                    Directory.CreateDirectory(Path.Combine(Directory.GetCurrentDirectory(), d));
                }
            }
            AssetDatabase.Refresh();
        }

        /// <summary>
        /// Renders Cam_Hero at the reference image's resolution so the two can be
        /// compared side by side.
        /// </summary>
        [MenuItem("GameShow/Capture Hero Shot")]
        public static void CaptureHeroShot()
        {
            const int width = 1672;
            const int height = 941;

            var camGo = GameObject.Find("WheelStage/Cam_Hero");
            if (camGo == null)
            {
                Debug.LogError("[WheelStageBuilder] Cam_Hero not in the open scene.");
                return;
            }
            var cam = camGo.GetComponent<Camera>();

            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32,
                RenderTextureReadWrite.sRGB);
            rt.antiAliasing = 1;
            rt.Create();

            var previous = cam.targetTexture;
            cam.targetTexture = rt;
            // HDRP accumulates SSR and volumetrics over frames, so one render is noisy.
            for (int i = 0; i < 12; i++) { cam.Render(); }
            cam.targetTexture = previous;

            var active = RenderTexture.active;
            RenderTexture.active = rt;
            var shot = new Texture2D(width, height, TextureFormat.RGBA32, false);
            shot.ReadPixels(new Rect(0, 0, width, height), 0, 0);
            shot.Apply();
            RenderTexture.active = active;

            var dir = Path.Combine(Directory.GetCurrentDirectory(), "Captures");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "hero.png");
            File.WriteAllBytes(file, shot.EncodeToPNG());

            Object.DestroyImmediate(shot);
            rt.Release();
            Object.DestroyImmediate(rt);

            Debug.Log("[WheelStageBuilder] Captured " + file);
        }

        // ------------------------------------------------------------------
        // pipeline features
        // ------------------------------------------------------------------

        /// <summary>
        /// The stage floor is a mirror in the reference, so screen space
        /// reflections have to be compiled into the pipeline. They ship disabled
        /// in the HDRP quality assets this project was created with.
        /// </summary>
        static void EnsurePipelineFeatures()
        {
            foreach (var guid in AssetDatabase.FindAssets("t:HDRenderPipelineAsset"))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                var asset = AssetDatabase.LoadAssetAtPath<HDRenderPipelineAsset>(path);
                if (asset == null) { continue; }

                var settings = asset.currentPlatformRenderPipelineSettings;
                if (settings.supportSSR && settings.supportSSRTransparent) { continue; }

                settings.supportSSR = true;
                settings.supportSSRTransparent = true;
                asset.currentPlatformRenderPipelineSettings = settings;
                EditorUtility.SetDirty(asset);
                Debug.Log("[WheelStageBuilder] Enabled SSR on " + path);
            }
            AssetDatabase.SaveAssets();
        }

        // ------------------------------------------------------------------
        // materials
        // ------------------------------------------------------------------

        struct MatDef
        {
            public string name;
            public Color baseColor;     // linear, straight out of Blender
            public float metallic;
            public float smoothness;
            public float emissiveNits;  // 0 = not emissive
            public Color emissiveLdr;   // gamma space, HDMaterial multiplies by nits
            public bool ledScreen;      // gets the cyclorama texture
        }

        static readonly MatDef[] k_Materials =
        {
            new MatDef { name = "MAT_Bulb_Glass",    baseColor = new Color(1f, 0.93f, 0.74f),        metallic = 0f, smoothness = 0.92f, emissiveNits = 2600f,  emissiveLdr = new Color(1f, 0.90f, 0.68f) },
            new MatDef { name = "MAT_Crystal",       baseColor = new Color(0.85f, 0.60f, 0.95f),     metallic = 0f, smoothness = 0.95f, emissiveNits = 700f,   emissiveLdr = new Color(0.92f, 0.70f, 1f) },
            new MatDef { name = "MAT_Dark_Trim",     baseColor = new Color(0.06f, 0.06f, 0.08f),     metallic = 0f, smoothness = 0.65f },
            new MatDef { name = "MAT_Fixture_Body",  baseColor = new Color(0.05f, 0.05f, 0.06f),     metallic = 0f, smoothness = 0.58f },
            new MatDef { name = "MAT_Floor_Gloss",   baseColor = new Color(0.075f, 0.065f, 0.10f),   metallic = 0.55f, smoothness = 0.99f },
            new MatDef { name = "MAT_Gold_Dark",     baseColor = new Color(0.34f, 0.24f, 0.09f),     metallic = 1f, smoothness = 0.65f },
            new MatDef { name = "MAT_Gold_Trim",     baseColor = new Color(0.72f, 0.52f, 0.18f),     metallic = 1f, smoothness = 0.80f },
            new MatDef { name = "MAT_LED_Screen",    baseColor = Color.white,                        metallic = 0f, smoothness = 0.55f, emissiveNits = 340f,   emissiveLdr = Color.white, ledScreen = true },
            new MatDef { name = "MAT_Lens_Glow",     baseColor = new Color(1f, 0.95f, 0.82f),        metallic = 0f, smoothness = 0.92f, emissiveNits = 3200f,  emissiveLdr = new Color(1f, 0.94f, 0.80f) },
            new MatDef { name = "MAT_Metal_Polished",baseColor = new Color(0.78f, 0.79f, 0.82f),     metallic = 1f, smoothness = 0.88f },
            new MatDef { name = "MAT_Peg_Metal",     baseColor = new Color(0.30f, 0.31f, 0.34f),     metallic = 1f, smoothness = 0.70f },
            new MatDef { name = "MAT_Pillar_Body",   baseColor = new Color(0.11f, 0.10f, 0.14f),     metallic = 0f, smoothness = 0.86f },
            new MatDef { name = "MAT_Rubber_Black",  baseColor = new Color(0.03f, 0.03f, 0.03f),     metallic = 0f, smoothness = 0.40f },
            new MatDef { name = "MAT_Sector_Blue",   baseColor = new Color(0.09f, 0.22f, 0.86f),     metallic = 0f, smoothness = 0.65f },
            new MatDef { name = "MAT_Sector_Cream",  baseColor = new Color(0.96f, 0.90f, 0.72f),     metallic = 0f, smoothness = 0.65f },
            new MatDef { name = "MAT_Sector_Cyan",   baseColor = new Color(0.13f, 0.80f, 0.90f),     metallic = 0f, smoothness = 0.65f },
            new MatDef { name = "MAT_Sector_Gold",   baseColor = new Color(0.95f, 0.64f, 0.08f),     metallic = 0f, smoothness = 0.70f },
            new MatDef { name = "MAT_Sector_Pink",   baseColor = new Color(0.92f, 0.05f, 0.42f),     metallic = 0f, smoothness = 0.65f },
            new MatDef { name = "MAT_Sector_White",  baseColor = new Color(0.97f, 0.97f, 0.97f),     metallic = 0f, smoothness = 0.68f },
            new MatDef { name = "MAT_Truss_Metal",   baseColor = new Color(0.30f, 0.31f, 0.34f),     metallic = 1f, smoothness = 0.45f },
        };

        static Dictionary<string, Material> BuildMaterials()
        {
            var shader = Shader.Find("HDRP/Lit");
            if (shader == null)
            {
                Debug.LogError("[WheelStageBuilder] HDRP/Lit shader not found.");
                return new Dictionary<string, Material>();
            }

            var led = AssetDatabase.LoadAssetAtPath<Texture2D>(k_LedTexPath);
            var result = new Dictionary<string, Material>();

            foreach (var def in k_Materials)
            {
                var path = k_MaterialDir + "/" + def.name + ".mat";
                var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
                if (mat == null)
                {
                    mat = new Material(shader);
                    AssetDatabase.CreateAsset(mat, path);
                }
                mat.shader = shader;

                mat.SetColor("_BaseColor", def.baseColor);
                mat.SetFloat("_Metallic", def.metallic);
                mat.SetFloat("_Smoothness", def.smoothness);

                if (def.ledScreen && led != null)
                {
                    mat.SetTexture("_BaseColorMap", led);
                    mat.SetTexture("_EmissiveColorMap", led);
                }

                if (def.emissiveNits > 0f)
                {
                    HDMaterial.SetUseEmissiveIntensity(mat, true);
                    HDMaterial.SetEmissiveIntensity(mat, def.emissiveNits, EmissiveIntensityUnit.Nits);
                    HDMaterial.SetEmissiveColor(mat, def.emissiveLdr);
                    // Fully pre-exposed. Anything less and the nit values above stop
                    // being relative to the camera's exposure, which blows them out.
                    mat.SetFloat("_EmissiveExposureWeight", 1f);
                }
                else
                {
                    HDMaterial.SetUseEmissiveIntensity(mat, false);
                    HDMaterial.SetEmissiveColor(mat, Color.black);
                }

                HDMaterial.ValidateMaterial(mat);
                EditorUtility.SetDirty(mat);
                result[def.name] = mat;
            }

            AssetDatabase.SaveAssets();
            return result;
        }

        static readonly string[] k_GeometryFbx =
        {
            k_ModelDir + "/SM_Stage_Floor.fbx",
            k_ModelDir + "/SM_Stage_Wall.fbx",
            k_ModelDir + "/SM_Wheel.fbx",
            k_ModelDir + "/SM_Pillars.fbx",
            k_ModelDir + "/SM_Podium.fbx",
            k_ModelDir + "/SM_LightRig.fbx",
        };

        /// <summary>
        /// Configures the FBX importers. Materials are left off: Unity 6 dropped
        /// external material locations, so the importer can no longer bind our own
        /// .mat files by name. AssignMaterials does that from k_SlotMaterials instead.
        /// </summary>
        static void ConfigureModelImporters()
        {
            foreach (var path in k_GeometryFbx)
            {
                var mi = AssetImporter.GetAtPath(path) as ModelImporter;
                if (mi == null)
                {
                    Debug.LogError("[WheelStageBuilder] Missing model: " + path);
                    continue;
                }
                mi.globalScale = 1f;
                mi.useFileScale = true;
                mi.importCameras = false;
                mi.importLights = false;
                mi.importAnimation = false;
                mi.importBlendShapes = false;
                mi.animationType = ModelImporterAnimationType.None;
                mi.importNormals = ModelImporterNormals.Import;
                mi.weldVertices = true;
                mi.materialImportMode = ModelImporterMaterialImportMode.None;
                mi.SaveAndReimport();
            }
        }

        /// <summary>
        /// One entry per Blender mesh: "ObjectName=Slot0|Slot1|...". The slot order
        /// is the object's material_slots order in Blender, which the FBX exporter
        /// preserves as the submesh order.
        /// </summary>
        static readonly string[] k_SlotMaterials =
        {
            "Blinder_01_Body=MAT_Fixture_Body",
            "Blinder_01_Lens=MAT_Fixture_Body|MAT_Lens_Glow",
            "Blinder_02_Body=MAT_Fixture_Body",
            "Blinder_02_Lens=MAT_Fixture_Body|MAT_Lens_Glow",
            "Blinder_03_Body=MAT_Fixture_Body",
            "Blinder_03_Lens=MAT_Fixture_Body|MAT_Lens_Glow",
            "Blinder_04_Body=MAT_Fixture_Body",
            "Blinder_04_Lens=MAT_Fixture_Body|MAT_Lens_Glow",
            "Blinder_05_Body=MAT_Fixture_Body",
            "Blinder_05_Lens=MAT_Fixture_Body|MAT_Lens_Glow",
            "Blinder_06_Body=MAT_Fixture_Body",
            "Blinder_06_Lens=MAT_Fixture_Body|MAT_Lens_Glow",
            "Crest_Chevron=MAT_Crystal|MAT_Gold_Trim",
            "Crest_Crystal=MAT_Crystal|MAT_Gold_Trim",
            "Crest_Stalk=MAT_Gold_Dark",
            "Floor_Disc=MAT_Floor_Gloss",
            "Floor_Rings=MAT_Gold_Trim",
            "MH_01_Base=MAT_Fixture_Body",
            "MH_01_Head=MAT_Fixture_Body",
            "MH_01_Lens=MAT_Lens_Glow",
            "MH_01_Yoke=MAT_Fixture_Body",
            "MH_02_Base=MAT_Fixture_Body",
            "MH_02_Head=MAT_Fixture_Body",
            "MH_02_Lens=MAT_Lens_Glow",
            "MH_02_Yoke=MAT_Fixture_Body",
            "MH_03_Base=MAT_Fixture_Body",
            "MH_03_Head=MAT_Fixture_Body",
            "MH_03_Lens=MAT_Lens_Glow",
            "MH_03_Yoke=MAT_Fixture_Body",
            "MH_04_Base=MAT_Fixture_Body",
            "MH_04_Head=MAT_Fixture_Body",
            "MH_04_Lens=MAT_Lens_Glow",
            "MH_04_Yoke=MAT_Fixture_Body",
            "MH_05_Base=MAT_Fixture_Body",
            "MH_05_Head=MAT_Fixture_Body",
            "MH_05_Lens=MAT_Lens_Glow",
            "MH_05_Yoke=MAT_Fixture_Body",
            "MH_06_Base=MAT_Fixture_Body",
            "MH_06_Head=MAT_Fixture_Body",
            "MH_06_Lens=MAT_Lens_Glow",
            "MH_06_Yoke=MAT_Fixture_Body",
            "MH_07_Base=MAT_Fixture_Body",
            "MH_07_Head=MAT_Fixture_Body",
            "MH_07_Lens=MAT_Lens_Glow",
            "MH_07_Yoke=MAT_Fixture_Body",
            "MH_08_Base=MAT_Fixture_Body",
            "MH_08_Head=MAT_Fixture_Body",
            "MH_08_Lens=MAT_Lens_Glow",
            "MH_08_Yoke=MAT_Fixture_Body",
            "MH_09_Base=MAT_Fixture_Body",
            "MH_09_Head=MAT_Fixture_Body",
            "MH_09_Lens=MAT_Lens_Glow",
            "MH_09_Yoke=MAT_Fixture_Body",
            "MH_10_Base=MAT_Fixture_Body",
            "MH_10_Head=MAT_Fixture_Body",
            "MH_10_Lens=MAT_Lens_Glow",
            "MH_10_Yoke=MAT_Fixture_Body",
            "MH_11_Base=MAT_Fixture_Body",
            "MH_11_Head=MAT_Fixture_Body",
            "MH_11_Lens=MAT_Lens_Glow",
            "MH_11_Yoke=MAT_Fixture_Body",
            "MH_12_Base=MAT_Fixture_Body",
            "MH_12_Head=MAT_Fixture_Body",
            "MH_12_Lens=MAT_Lens_Glow",
            "MH_12_Yoke=MAT_Fixture_Body",
            "Pillar_L_Base=MAT_Gold_Dark|MAT_Gold_Trim",
            "Pillar_L_Cap=MAT_Pillar_Body|MAT_Gold_Trim",
            "Pillar_L_Collar=MAT_Gold_Trim",
            "Pillar_L_Core=MAT_Pillar_Body",
            "Pillar_R_Base=MAT_Gold_Dark|MAT_Gold_Trim",
            "Pillar_R_Cap=MAT_Pillar_Body|MAT_Gold_Trim",
            "Pillar_R_Collar=MAT_Gold_Trim",
            "Pillar_R_Core=MAT_Pillar_Body",
            "Podium_Body=MAT_Dark_Trim",
            "Podium_Desk=MAT_Dark_Trim|MAT_Gold_Trim",
            "Podium_Monitor=MAT_Dark_Trim|MAT_Gold_Trim",
            "Podium_Panels=MAT_Gold_Dark|MAT_Dark_Trim",
            "Podium_Riser=MAT_LED_Screen|MAT_Gold_Dark",
            "Podium_Top=MAT_Dark_Trim|MAT_Gold_Trim",
            "Podium_Trim=MAT_Gold_Dark|MAT_Gold_Trim",
            "Pointer_Flapper=MAT_Crystal|MAT_Gold_Trim|MAT_Metal_Polished",
            "Truss_Brace=MAT_Truss_Metal",
            "Truss_Brace_Inner=MAT_Truss_Metal",
            "Truss_Links=MAT_Truss_Metal",
            "Truss_Par_Body=MAT_Fixture_Body",
            "Truss_Par_Lens=MAT_Lens_Glow",
            "Truss_Ring=MAT_Truss_Metal",
            "Truss_Ring_Inner=MAT_Truss_Metal",
            "Wall_Band_Mid=MAT_Gold_Trim",
            "Wall_Band_Up=MAT_Gold_Trim",
            "Wall_Fascia=MAT_Gold_Dark|MAT_Gold_Trim",
            "Wall_Plinth=MAT_Dark_Trim",
            "Wall_Screen=MAT_LED_Screen",
            "Wheel_Axle=MAT_Metal_Polished|MAT_Gold_Dark",
            "Wheel_BackPlate=MAT_Dark_Trim",
            "Wheel_BasePlate=MAT_Dark_Trim|MAT_Gold_Trim",
            "Wheel_Bulbs=MAT_Bulb_Glass",
            "Wheel_CrossBar=MAT_Dark_Trim|MAT_Gold_Dark",
            "Wheel_Hub=MAT_Metal_Polished",
            "Wheel_HubRing=MAT_Dark_Trim",
            "Wheel_HubRivets=MAT_Metal_Polished",
            "Wheel_Legs=MAT_Metal_Polished|MAT_Gold_Dark",
            "Wheel_Pegs=MAT_Peg_Metal|MAT_Gold_Trim",
            "Wheel_Rim=MAT_Gold_Trim",
            "Wheel_Sector_01=MAT_Sector_Pink",
            "Wheel_Sector_02=MAT_Sector_White",
            "Wheel_Sector_03=MAT_Sector_Gold",
            "Wheel_Sector_04=MAT_Sector_Cream",
            "Wheel_Sector_05=MAT_Sector_Cyan",
            "Wheel_Sector_06=MAT_Sector_White",
            "Wheel_Sector_07=MAT_Sector_Pink",
            "Wheel_Sector_08=MAT_Sector_Blue",
            "Wheel_Sector_09=MAT_Sector_Gold",
            "Wheel_Sector_10=MAT_Sector_White",
            "Wheel_Sector_11=MAT_Sector_Cyan",
            "Wheel_Sector_12=MAT_Sector_Cream",
            "Wheel_Sector_13=MAT_Sector_Pink",
            "Wheel_Sector_14=MAT_Sector_White",
            "Wheel_Sector_15=MAT_Sector_Gold",
            "Wheel_Sector_16=MAT_Sector_Cream",
            "Wheel_Sector_17=MAT_Sector_Cyan",
            "Wheel_Sector_18=MAT_Sector_White",
            "Wheel_Sector_19=MAT_Sector_Pink",
            "Wheel_Sector_20=MAT_Sector_Blue",
            "Wheel_Sector_21=MAT_Sector_Gold",
            "Wheel_Sector_22=MAT_Sector_White",
            "Wheel_Sector_23=MAT_Sector_Cyan",
            "Wheel_Sector_24=MAT_Sector_Cream",
            "Wheel_Sector_25=MAT_Sector_Pink",
            "Wheel_Sector_26=MAT_Sector_White",
            "Wheel_Sector_27=MAT_Sector_Gold",
            "Wheel_Sector_28=MAT_Sector_Cream",
            "Wheel_Sector_29=MAT_Sector_Cyan",
            "Wheel_Sector_30=MAT_Sector_White",
            "Wheel_Sector_31=MAT_Sector_Pink",
            "Wheel_Sector_32=MAT_Sector_Blue",
            "Wheel_Sector_33=MAT_Sector_Gold",
            "Wheel_Sector_34=MAT_Sector_White",
            "Wheel_Sector_35=MAT_Sector_Cyan",
            "Wheel_Sector_36=MAT_Sector_Cream",
            "Wheel_Sector_37=MAT_Sector_Pink",
            "Wheel_Sector_38=MAT_Sector_White",
            "Wheel_Sector_39=MAT_Sector_Gold",
            "Wheel_Sector_40=MAT_Sector_Cream",
            "Wheel_Sector_41=MAT_Sector_Cyan",
            "Wheel_Sector_42=MAT_Sector_White",
            "Wheel_Sector_43=MAT_Sector_Pink",
            "Wheel_Sector_44=MAT_Sector_Blue",
            "Wheel_Sector_45=MAT_Sector_Gold",
            "Wheel_Sector_46=MAT_Sector_White",
            "Wheel_Sector_47=MAT_Sector_Cyan",
            "Wheel_Sector_48=MAT_Sector_Cream",
            "Wheel_Spokes=MAT_Gold_Trim",
        };

        static void AssignMaterials(GameObject geometry, Dictionary<string, Material> materials)
        {
            var bySlot = new Dictionary<string, string[]>();
            foreach (var entry in k_SlotMaterials)
            {
                var split = entry.Split('=');
                bySlot[split[0]] = split[1].Split('|');
            }

            var problems = new List<string>();
            foreach (var renderer in geometry.GetComponentsInChildren<MeshRenderer>(true))
            {
                string[] wanted;
                if (!bySlot.TryGetValue(renderer.name, out wanted))
                {
                    problems.Add(renderer.name + ": no material entry");
                    continue;
                }

                var filter = renderer.GetComponent<MeshFilter>();
                int submeshes = filter != null && filter.sharedMesh != null ? filter.sharedMesh.subMeshCount : 1;
                if (submeshes != wanted.Length)
                {
                    problems.Add(renderer.name + ": " + submeshes + " submeshes but " + wanted.Length + " slots");
                }

                var assigned = new Material[submeshes];
                for (int i = 0; i < submeshes; i++)
                {
                    var name = i < wanted.Length ? wanted[i] : wanted[wanted.Length - 1];
                    Material mat;
                    if (!materials.TryGetValue(name, out mat))
                    {
                        problems.Add(renderer.name + "[" + i + "]: unknown material " + name);
                        continue;
                    }
                    assigned[i] = mat;
                }
                renderer.sharedMaterials = assigned;
            }

            if (problems.Count > 0)
            {
                Debug.LogWarning("[WheelStageBuilder] Material assignment issues:\n" +
                    string.Join("\n", problems.ToArray()));
            }
        }

        // ------------------------------------------------------------------
        // LED cyclorama texture
        // ------------------------------------------------------------------

        /// <summary>
        /// Paints the sunset cloudscape that plays on the curved LED wall. The
        /// noise wraps in U so the strip tiles around the full ring.
        /// </summary>
        static void EnsureLedTexture()
        {
            const int width = 2048;
            const int height = 512;

            var tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
            var pixels = new Color[width * height];

            for (int y = 0; y < height; y++)
            {
                float v = y / (float)(height - 1);
                Color sky = SkyGradient(v);

                for (int x = 0; x < width; x++)
                {
                    float u = x / (float)width;

                    // Three layers: big cumulus masses, the banks that build them,
                    // and thin streaks up high. Low frequencies do the heavy lifting,
                    // otherwise the wall reads as noise rather than weather.
                    float mass = Fbm(u, v * 0.8f, 4, 2.5f);
                    float bank = Fbm(u + 0.21f, v * 1.2f, 5, 5f);
                    float wisp = Fbm(u + 0.37f, v * 2.1f + 0.6f, 4, 13f);

                    float massMask = Mathf.SmoothStep(0f, 1f, Remap(mass, 0.46f, 0.60f)) * Falloff(v, 0.02f, 0.70f);
                    float bankMask = Mathf.SmoothStep(0f, 1f, Remap(bank, 0.50f, 0.64f)) * Falloff(v, 0.05f, 0.60f);
                    float wispMask = Mathf.SmoothStep(0f, 1f, Remap(wisp, 0.54f, 0.76f)) * Falloff(v, 0.32f, 0.96f) * 0.45f;

                    // Clouds are lit from below by the sunset, so the low ones stay
                    // warm and the high ones pick up the violet of the upper sky.
                    Color lowLit = new Color(1f, 0.72f, 0.55f);
                    Color highLit = new Color(0.72f, 0.62f, 1f);
                    Color cloud = Color.Lerp(lowLit, highLit, Mathf.Clamp01(v * 1.25f));
                    // Self-shadowing: the underside of each mass stays in the sky's colour.
                    Color shade = Color.Lerp(cloud * 0.45f, sky, 0.35f);

                    Color c = sky;
                    c = Color.Lerp(c, shade, Mathf.Clamp01(massMask));
                    c = Color.Lerp(c, cloud, Mathf.Clamp01(massMask * bankMask * 1.6f));
                    c = Color.Lerp(c, cloud * 1.15f, Mathf.Clamp01(bankMask * 0.7f));
                    c = Color.Lerp(c, cloud * 1.1f, Mathf.Clamp01(wispMask));

                    // Sparkles, as in the reference's glittering upper sky.
                    float sparkle = Mathf.PerlinNoise(u * 420f, v * 420f);
                    if (sparkle > 0.86f && v > 0.35f)
                    {
                        float s = Remap(sparkle, 0.86f, 1f);
                        c += new Color(0.9f, 0.85f, 1f) * s * s * 0.8f;
                    }

                    pixels[y * width + x] = new Color(c.r, c.g, c.b, 1f);
                }
            }

            tex.SetPixels(pixels);
            tex.Apply();

            var bytes = tex.EncodeToPNG();
            Object.DestroyImmediate(tex);
            File.WriteAllBytes(Path.Combine(Directory.GetCurrentDirectory(), k_LedTexPath), bytes);
            AssetDatabase.ImportAsset(k_LedTexPath, ImportAssetOptions.ForceUpdate);

            var ti = AssetImporter.GetAtPath(k_LedTexPath) as TextureImporter;
            if (ti != null)
            {
                ti.textureType = TextureImporterType.Default;
                ti.sRGBTexture = true;
                ti.wrapModeU = TextureWrapMode.Repeat;
                ti.wrapModeV = TextureWrapMode.Clamp;
                ti.mipmapEnabled = true;
                ti.maxTextureSize = 2048;
                ti.SaveAndReimport();
            }
        }

        static Color SkyGradient(float v)
        {
            // Bottom to top: warm horizon, hot magenta, violet, deep blue.
            Color horizon = new Color(1.00f, 0.45f, 0.32f);
            Color magenta = new Color(0.88f, 0.28f, 0.66f);
            Color violet = new Color(0.42f, 0.24f, 0.86f);
            Color deep = new Color(0.10f, 0.14f, 0.52f);

            if (v < 0.28f) { return Color.Lerp(horizon, magenta, v / 0.28f); }
            if (v < 0.62f) { return Color.Lerp(magenta, violet, (v - 0.28f) / 0.34f); }
            return Color.Lerp(violet, deep, (v - 0.62f) / 0.38f);
        }

        static float Remap(float x, float a, float b)
        {
            return Mathf.Clamp01((x - a) / Mathf.Max(1e-5f, b - a));
        }

        /// <summary>Fades in over [lo, lo+band] and out over [hi-band, hi].</summary>
        static float Falloff(float v, float lo, float hi)
        {
            return Mathf.SmoothStep(0f, 1f, Remap(v, lo, lo + 0.12f)) *
                   (1f - Mathf.SmoothStep(0f, 1f, Remap(v, hi - 0.18f, hi)));
        }

        static float Fbm(float u, float v, int octaves, float frequency)
        {
            float sum = 0f;
            float amp = 0.5f;
            float norm = 0f;
            float f = frequency;
            for (int o = 0; o < octaves; o++)
            {
                sum += amp * SeamlessNoise(u, v, f);
                norm += amp;
                amp *= 0.5f;
                f *= 2f;
            }
            return sum / Mathf.Max(1e-5f, norm);
        }

        /// <summary>Perlin noise that wraps at u = 0 and u = 1.</summary>
        static float SeamlessNoise(float u, float v, float f)
        {
            float a = Mathf.PerlinNoise(u * f, v * f);
            float b = Mathf.PerlinNoise((u - 1f) * f, v * f);
            return Mathf.Lerp(a, b, u);
        }

        // ------------------------------------------------------------------
        // lights
        // ------------------------------------------------------------------

        struct LightDef
        {
            public string name;
            public LightType type;
            public Vector3 pos;
            public Vector3 forward;
            public Vector3 up;
            public Color color;      // gamma space
            public float lumens;
            public float range;
            public float spotAngle;
            public float innerAngle;
            public Vector2 areaSize;
            public bool shadows;
            public float volumetric;
            public float shaftIntensity;   // peak additive value, 0 = no shaft geometry
        }

        /// <summary>
        /// The two beam spots come straight from Blender's 70_Lights collection:
        /// they graze past the wheel and land on the floor, which is what makes the
        /// visible shafts. The rest of the rig keys the wheel face, which Blender's
        /// rig never did, so the wheel arrived as a silhouette.
        /// </summary>
        static readonly LightDef[] k_StageLights =
        {
            new LightDef {
                name = "Beam_L", type = LightType.Spot,
                pos = new Vector3(6.5f, 7.2f, 3f),
                forward = new Vector3(-0.47946f, -0.76713f, -0.42618f),
                up = new Vector3(-0.57336f, 0.64149f, -0.50965f),
                color = new Color(0.72f, 0.36f, 1f), lumens = 42000f, range = 40f,
                spotAngle = 22f, innerAngle = 16.5f, shadows = true, volumetric = 1f,
                shaftIntensity = 0.50f,
            },
            new LightDef {
                name = "Beam_R", type = LightType.Spot,
                pos = new Vector3(-6.5f, 7.2f, 3f),
                forward = new Vector3(0.47946f, -0.76713f, -0.42618f),
                up = new Vector3(0.57336f, 0.64149f, -0.50965f),
                color = new Color(0.72f, 0.36f, 1f), lumens = 42000f, range = 40f,
                spotAngle = 22f, innerAngle = 16.5f, shadows = true, volumetric = 1f,
                shaftIntensity = 0.50f,
            },
            // Broad soft key straight onto the wheel face, high and in front.
            new LightDef {
                name = "Wheel_Key", type = LightType.Rectangle,
                pos = new Vector3(0f, 7f, 4.6f),
                color = new Color(1f, 0.94f, 0.86f), lumens = 7500f, range = 26f,
                areaSize = new Vector2(10f, 4f), shadows = true, volumetric = 0.15f,
            },
            // Coloured three-quarter fills that give the rim its magenta/cyan roll-off.
            new LightDef {
                name = "Wheel_Fill_L", type = LightType.Rectangle,
                pos = new Vector3(6.2f, 3.6f, 4.2f),
                color = new Color(1f, 0.45f, 0.72f), lumens = 8000f, range = 22f,
                areaSize = new Vector2(3f, 3f), shadows = false, volumetric = 0.2f,
            },
            new LightDef {
                name = "Wheel_Fill_R", type = LightType.Rectangle,
                pos = new Vector3(-6.2f, 3.6f, 4.2f),
                color = new Color(0.45f, 0.68f, 1f), lumens = 8000f, range = 22f,
                areaSize = new Vector2(3f, 3f), shadows = false, volumetric = 0.2f,
            },
            // Low warm bounce off the floor, so the wheel's underside is not black.
            new LightDef {
                name = "Wheel_Bounce", type = LightType.Rectangle,
                pos = new Vector3(0f, 0.35f, 3.2f),
                color = new Color(1f, 0.78f, 0.5f), lumens = 7000f, range = 16f,
                areaSize = new Vector2(6f, 1.5f), shadows = false, volumetric = 0.1f,
            },
            new LightDef {
                name = "Fill_Front", type = LightType.Rectangle,
                pos = new Vector3(0f, 2f, 7.5f),
                forward = new Vector3(0f, -0.06652f, -0.99779f),
                up = new Vector3(0f, 0.99779f, -0.06652f),
                color = new Color(0.6f, 0.6f, 0.9f), lumens = 9000f, range = 26f,
                areaSize = new Vector2(6f, 1f), shadows = false, volumetric = 0.2f,
            },
            new LightDef {
                name = "Rim_L", type = LightType.Rectangle,
                pos = new Vector3(8f, 3.5f, -3.5f),
                forward = new Vector3(-0.9289f, -0.08708f, 0.35995f),
                up = new Vector3(-0.0812f, 0.9962f, 0.03147f),
                color = new Color(0.35f, 0.55f, 1f), lumens = 22000f, range = 26f,
                areaSize = new Vector2(3f, 1f), shadows = false, volumetric = 0.4f,
            },
            new LightDef {
                name = "Rim_R", type = LightType.Rectangle,
                pos = new Vector3(-8f, 3.5f, -3.5f),
                forward = new Vector3(0.9289f, -0.08708f, 0.35995f),
                up = new Vector3(0.0812f, 0.9962f, 0.03147f),
                color = new Color(1f, 0.3f, 0.65f), lumens = 22000f, range = 26f,
                areaSize = new Vector2(3f, 1f), shadows = false, volumetric = 0.4f,
            },
            // Amber uplights grazing the two foreground pillars.
            new LightDef {
                name = "Pillar_Up_L", type = LightType.Spot,
                pos = new Vector3(7.29f, 0.2f, -5.4f),
                forward = new Vector3(0f, 1f, 0f), up = new Vector3(0f, 0f, 1f),
                color = new Color(1f, 0.72f, 0.35f), lumens = 12000f, range = 12f,
                spotAngle = 40f, innerAngle = 12f, shadows = false, volumetric = 0.3f,
            },
            new LightDef {
                name = "Pillar_Up_R", type = LightType.Spot,
                pos = new Vector3(-7.29f, 0.2f, -5.4f),
                forward = new Vector3(0f, 1f, 0f), up = new Vector3(0f, 0f, 1f),
                color = new Color(1f, 0.72f, 0.35f), lumens = 12000f, range = 12f,
                spotAngle = 40f, innerAngle = 12f, shadows = false, volumetric = 0.3f,
            },
        };

        /// <summary>
        /// The twelve moving heads. Position and aim come from each MH_xx_Head
        /// transform in Blender: the barrel runs down the head's local +Y, which
        /// in Unity space is the aim vector below. Colours follow the reference,
        /// where frame-right runs warm and the back trusses run cool.
        /// </summary>
        struct MovingHeadDef
        {
            public string name;
            public Vector3 pos;
            public Vector3 aim;
            public Color color;
        }

        static readonly Color k_Violet = new Color(0.62f, 0.30f, 1f);
        static readonly Color k_Amber = new Color(1f, 0.68f, 0.28f);
        static readonly Color k_Cyan = new Color(0.30f, 0.72f, 1f);
        static readonly Color k_Magenta = new Color(1f, 0.28f, 0.70f);

        static readonly MovingHeadDef[] k_MovingHeads =
        {
            new MovingHeadDef { name = "MH_01", pos = new Vector3(-9.8524f, 6.34f, -3.14f),  aim = new Vector3(0.7592f, -0.61566f, 0.21113f),  color = k_Amber },
            new MovingHeadDef { name = "MH_02", pos = new Vector3(-7.2125f, 6.34f, -7.7125f), aim = new Vector3(0.43233f, -0.78801f, 0.43833f), color = k_Violet },
            new MovingHeadDef { name = "MH_03", pos = new Vector3(-2.64f, 6.34f, -10.3524f),  aim = new Vector3(0.15785f, -0.78801f, 0.59508f), color = k_Amber },
            new MovingHeadDef { name = "MH_04", pos = new Vector3(2.64f, 6.34f, -10.3524f),   aim = new Vector3(-0.20204f, -0.61566f, 0.76167f), color = k_Violet },
            new MovingHeadDef { name = "MH_05", pos = new Vector3(7.2125f, 6.34f, -7.7125f),  aim = new Vector3(-0.43233f, -0.78801f, 0.43833f), color = k_Violet },
            new MovingHeadDef { name = "MH_06", pos = new Vector3(9.8524f, 6.34f, -3.14f),    aim = new Vector3(-0.59315f, -0.78801f, 0.16495f), color = k_Violet },
            new MovingHeadDef { name = "MH_07", pos = new Vector3(9.8524f, 6.34f, 2.14f),     aim = new Vector3(-0.76306f, -0.61566f, -0.19672f), color = k_Cyan },
            new MovingHeadDef { name = "MH_08", pos = new Vector3(7.2125f, 6.34f, 6.7125f),   aim = new Vector3(-0.43837f, -0.78801f, -0.43229f), color = k_Magenta },
            new MovingHeadDef { name = "MH_09", pos = new Vector3(2.64f, 6.34f, 9.3524f),     aim = new Vector3(-0.16087f, -0.78801f, -0.59427f), color = k_Cyan },
            new MovingHeadDef { name = "MH_10", pos = new Vector3(-2.64f, 6.34f, 9.3524f),    aim = new Vector3(0.2059f, -0.61566f, -0.76064f),  color = k_Magenta },
            new MovingHeadDef { name = "MH_11", pos = new Vector3(-7.2125f, 6.34f, 6.7125f),  aim = new Vector3(0.43837f, -0.78801f, -0.43229f), color = k_Cyan },
            new MovingHeadDef { name = "MH_12", pos = new Vector3(-9.8524f, 6.34f, 2.14f),    aim = new Vector3(0.59617f, -0.61566f, -0.15369f), color = k_Magenta },
        };

        /// <summary>
        /// Four wide washes standing in for the light the LED wall throws back
        /// into the room. HDRP has no realtime emissive bounce, so without these
        /// the floor loses the wall's colour entirely.
        /// </summary>
        struct WashDef
        {
            public string name;
            public Vector3 pos;
            public Color color;
        }

        static readonly WashDef[] k_CycWashes =
        {
            new WashDef { name = "CycWash_FL", pos = new Vector3(7.5f, 3.2f, -7.5f), color = new Color(0.55f, 0.35f, 1f) },
            new WashDef { name = "CycWash_FR", pos = new Vector3(-7.5f, 3.2f, -7.5f), color = new Color(1f, 0.40f, 0.70f) },
            new WashDef { name = "CycWash_BL", pos = new Vector3(9f, 3.2f, 2f), color = new Color(0.40f, 0.55f, 1f) },
            new WashDef { name = "CycWash_BR", pos = new Vector3(-9f, 3.2f, 2f), color = new Color(1f, 0.55f, 0.45f) },
        };

        // ------------------------------------------------------------------
        // scene
        // ------------------------------------------------------------------

        static void BuildScene(Dictionary<string, Material> materials)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var root = new GameObject("WheelStage");
            var geometry = NewChild("Geometry", root.transform);
            var lighting = NewChild("Lighting", root.transform);
            var post = NewChild("PostFX", root.transform);

            foreach (var path in k_GeometryFbx)
            {
                var asset = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                if (asset == null)
                {
                    Debug.LogError("[WheelStageBuilder] Could not load " + path);
                    continue;
                }
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(asset);
                instance.name = Path.GetFileNameWithoutExtension(path);
                instance.transform.SetParent(geometry.transform, false);
                instance.transform.localPosition = Vector3.zero;
                instance.transform.localRotation = Quaternion.identity;
                instance.transform.localScale = Vector3.one;
            }

            AssignMaterials(geometry, materials);
            ReportUnassignedMaterials(geometry);

            foreach (var def in k_StageLights)
            {
                CreateLight(def, lighting.transform);
            }

            foreach (var mh in k_MovingHeads)
            {
                CreateLight(new LightDef
                {
                    name = mh.name + "_Beam",
                    type = LightType.Spot,
                    pos = mh.pos,
                    forward = mh.aim,
                    up = Vector3.up,
                    color = mh.color,
                    lumens = 30000f,
                    range = 32f,
                    spotAngle = 15f,
                    innerAngle = 9f,
                    shadows = false,
                    volumetric = 1f,
                    shaftIntensity = 0.32f,
                }, lighting.transform);
            }

            foreach (var wash in k_CycWashes)
            {
                var aim = (k_WheelHub - wash.pos).normalized;
                CreateLight(new LightDef
                {
                    name = wash.name,
                    type = LightType.Spot,
                    pos = wash.pos,
                    forward = aim,
                    up = Vector3.up,
                    color = wash.color,
                    lumens = 12000f,
                    range = 30f,
                    spotAngle = 110f,
                    innerAngle = 30f,
                    shadows = false,
                    volumetric = 0.25f,
                }, lighting.transform);
            }

            CreateReflectionProbe(lighting.transform);
            CreateVolume(post.transform);
            CreateCamera(root.transform);

            EditorSceneManager.SaveScene(scene, k_ScenePath);
            AddSceneToBuildSettings();
        }

        // ------------------------------------------------------------------
        // light shafts
        // ------------------------------------------------------------------

        const string k_BeamMeshPath = "Assets/Art/Shaders/BeamCone.asset";

        /// <summary>
        /// Builds the additive cone that stands in for a light shaft, and parents it
        /// to the light so it always points where the light does. The cone is a unit
        /// throw along +Z; the caller scales it to the fixture's angle and range.
        /// </summary>
        static void AddBeamCone(GameObject lightGo, float spotAngleDeg, float throwLength, Color color, float intensity)
        {
            var shader = Shader.Find("GameShow/BeamAdditive");
            if (shader == null)
            {
                Debug.LogWarning("[WheelStageBuilder] GameShow/BeamAdditive shader not found; skipping shafts.");
                return;
            }

            var go = NewChild(lightGo.name + "_Shaft", lightGo.transform);
            go.transform.localPosition = Vector3.zero;
            go.transform.localRotation = Quaternion.identity;

            float radius = throwLength * Mathf.Tan(spotAngleDeg * 0.5f * Mathf.Deg2Rad);
            go.transform.localScale = new Vector3(radius, radius, throwLength);

            go.AddComponent<MeshFilter>().sharedMesh = GetBeamConeMesh();

            var mat = new Material(shader);
            mat.name = "MAT_Beam_" + lightGo.name;
            mat.SetColor("_BeamColor", new Color(color.r * intensity, color.g * intensity, color.b * intensity, 1f));
            mat.SetFloat("_EdgeSoftness", 3.2f);
            mat.SetFloat("_LengthFade", 1.7f);
            mat.SetFloat("_ApexFade", 0.04f);

            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = mat;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        static Mesh s_BeamCone;

        /// <summary>Open cone: apex at the origin, unit radius at z = 1.</summary>
        static Mesh GetBeamConeMesh()
        {
            if (s_BeamCone != null) { return s_BeamCone; }

            var existing = AssetDatabase.LoadAssetAtPath<Mesh>(k_BeamMeshPath);
            if (existing != null)
            {
                s_BeamCone = existing;
                return s_BeamCone;
            }

            const int segments = 48;
            const int rings = 12;

            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new List<int>();

            for (int ring = 0; ring <= rings; ring++)
            {
                float t = ring / (float)rings;
                for (int seg = 0; seg <= segments; seg++)
                {
                    float a = seg / (float)segments * Mathf.PI * 2f;
                    float cos = Mathf.Cos(a);
                    float sin = Mathf.Sin(a);
                    vertices.Add(new Vector3(cos * t, sin * t, t));
                    // Cone surface normal: radial, tilted back along the axis by the
                    // half-angle of the unit cone (45 degrees at unit radius).
                    normals.Add(new Vector3(cos, sin, -1f).normalized);
                    uvs.Add(new Vector2(seg / (float)segments, t));
                }
            }

            int stride = segments + 1;
            for (int ring = 0; ring < rings; ring++)
            {
                for (int seg = 0; seg < segments; seg++)
                {
                    int a = ring * stride + seg;
                    int b = a + 1;
                    int c = a + stride;
                    int d = c + 1;
                    triangles.Add(a); triangles.Add(c); triangles.Add(b);
                    triangles.Add(b); triangles.Add(c); triangles.Add(d);
                }
            }

            var mesh = new Mesh { name = "BeamCone" };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();

            AssetDatabase.CreateAsset(mesh, k_BeamMeshPath);
            s_BeamCone = mesh;
            return s_BeamCone;
        }

        static GameObject NewChild(string name, Transform parent)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            return go;
        }

        static GameObject CreateLight(LightDef def, Transform parent)
        {
            // A definition with no explicit aim points at the wheel hub.
            var forward = def.forward.sqrMagnitude > 1e-6f
                ? def.forward.normalized
                : (k_WheelHub - def.pos).normalized;
            var up = def.up.sqrMagnitude > 1e-6f ? def.up.normalized : Vector3.up;
            if (Mathf.Abs(Vector3.Dot(forward, up)) > 0.999f) { up = Vector3.forward; }

            var go = NewChild(def.name, parent);
            go.transform.position = def.pos;
            go.transform.rotation = Quaternion.LookRotation(forward, up);

            var light = go.AddComponent<Light>();
            var hd = go.AddComponent<HDAdditionalLightData>();

            light.type = def.type;
            light.color = def.color;
            light.lightUnit = LightUnit.Lumen;
            light.intensity = def.lumens;
            light.range = def.range;
            light.shadows = def.shadows ? LightShadows.Soft : LightShadows.None;

            if (def.type == LightType.Spot)
            {
                light.spotAngle = def.spotAngle;
                light.innerSpotAngle = def.innerAngle;
                light.enableSpotReflector = false;
            }
            else if (def.type == LightType.Rectangle)
            {
                light.areaSize = def.areaSize;
            }

            hd.affectsVolumetric = def.volumetric > 0f;
            hd.volumetricDimmer = def.volumetric;
            hd.lightDimmer = 1f;

            if (def.shaftIntensity > 0f && def.type == LightType.Spot)
            {
                AddBeamCone(go, def.spotAngle, ShaftThrow(def.pos, forward, def.range), def.color, def.shaftIntensity);
            }

            return go;
        }

        /// <summary>Distance from the fixture to where its axis meets the floor.</summary>
        static float ShaftThrow(Vector3 pos, Vector3 forward, float range)
        {
            float throwLength = range;
            if (forward.y < -0.01f)
            {
                throwLength = pos.y / -forward.y;
            }
            return Mathf.Clamp(throwLength, 4f, range);
        }

        static void CreateReflectionProbe(Transform parent)
        {
            var go = NewChild("StageReflectionProbe", parent);
            go.transform.position = new Vector3(0f, 3.5f, -1.2f);

            var probe = go.AddComponent<ReflectionProbe>();
            go.AddComponent<HDAdditionalReflectionData>();
            probe.mode = ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.ViaScripting;
            probe.timeSlicingMode = ReflectionProbeTimeSlicingMode.IndividualFaces;
            probe.size = new Vector3(26f, 12f, 26f);
            probe.resolution = 256;
            probe.nearClipPlane = 0.3f;
            probe.farClipPlane = 60f;
            probe.RenderProbe();
        }

        static void CreateVolume(Transform parent)
        {
            var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(k_ProfilePath);
            if (profile == null)
            {
                profile = ScriptableObject.CreateInstance<VolumeProfile>();
                AssetDatabase.CreateAsset(profile, k_ProfilePath);
            }
            else
            {
                // Rebuild from scratch so re-running does not stack overrides.
                foreach (var c in profile.components.ToArray())
                {
                    profile.Remove(c.GetType());
                    Object.DestroyImmediate(c, true);
                }
            }

            var env = profile.Add<VisualEnvironment>(true);
            env.skyType.value = (int)SkyType.Gradient;
            env.skyAmbientMode.value = SkyAmbientMode.Dynamic;

            // The arena ceiling: almost black, with a faint violet lift so metals
            // have something to reflect instead of pure void.
            var sky = profile.Add<GradientSky>(true);
            sky.top.value = new Color(0.02f, 0.02f, 0.06f);
            sky.middle.value = new Color(0.08f, 0.04f, 0.16f);
            sky.bottom.value = new Color(0.12f, 0.06f, 0.20f);
            sky.gradientDiffusion.value = 2.2f;
            sky.skyIntensityMode.value = SkyIntensityMode.Multiplier;
            sky.multiplier.value = 0.6f;

            // A TV stage keyed at a few thousand lux. Every light intensity and
            // emissive nit value in this file is calibrated against this EV.
            var exposure = profile.Add<Exposure>(true);
            exposure.mode.value = ExposureMode.Fixed;
            exposure.fixedExposure.value = 9f;

            // Depth haze only. HDRP's volumetric lighting does not scatter in this
            // project even with Volumetrics enabled on the camera's frame settings,
            // so the visible shafts are the additive cones on each beam fixture
            // instead, and this fog just gives the far wall some atmosphere.
            var fog = profile.Add<Fog>(true);
            fog.enabled.value = true;
            fog.enableVolumetricFog.value = false;
            fog.meanFreePath.value = 70f;
            fog.baseHeight.value = 0f;
            fog.maximumHeight.value = 10f;
            fog.albedo.value = new Color(0.9f, 0.87f, 1f);
            // Near isotropic on purpose. The beams cross the frame side-on, and a
            // strongly forward phase function (g near 1) scatters their light away
            // from the camera, which makes the shafts vanish.
            fog.anisotropy.value = 0.15f;
            fog.depthExtent.value = 45f;
            fog.multipleScatteringIntensity.value = 0.4f;
            fog.colorMode.value = FogColorMode.ConstantColor;
            fog.color.value = new Color(0.11f, 0.06f, 0.24f);
            fog.tint.value = new Color(0.85f, 0.78f, 1f);

            var bloom = profile.Add<Bloom>(true);
            bloom.intensity.value = 0.24f;
            bloom.scatter.value = 0.7f;
            bloom.threshold.value = 1.1f;
            bloom.tint.value = new Color(1f, 0.94f, 1f);

            var tonemap = profile.Add<Tonemapping>(true);
            tonemap.mode.value = TonemappingMode.ACES;

            var grade = profile.Add<ColorAdjustments>(true);
            grade.postExposure.value = 0.15f;
            grade.contrast.value = 12f;
            grade.saturation.value = 22f;

            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.value = 0.30f;
            vignette.smoothness.value = 0.45f;
            vignette.roundness.value = 0.8f;

            var ca = profile.Add<ChromaticAberration>(true);
            ca.intensity.value = 0.02f;

            var ssr = profile.Add<ScreenSpaceReflection>(true);
            ssr.enabled.value = true;
            ssr.usedAlgorithm.value = ScreenSpaceReflectionAlgorithm.PBRAccumulation;
            ssr.reflectSky.value = true;
            ssr.depthBufferThickness.value = 0.02f;

            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();

            var go = NewChild("Global Volume", parent);
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.sharedProfile = profile;
        }

        static void CreateCamera(Transform parent)
        {
            var go = NewChild("Cam_Hero", parent);
            go.tag = "MainCamera";
            go.transform.position = new Vector3(0f, 1f, 6.4f);
            go.transform.rotation = Quaternion.LookRotation(
                new Vector3(0f, 0.27564f, -0.96126f), new Vector3(0f, 0.96126f, 0.27564f));

            var cam = go.AddComponent<Camera>();
            // Blender's Cam_Hero: 22 mm on a 36 x 24 sensor, fitted horizontally.
            cam.usePhysicalProperties = true;
            cam.focalLength = 22f;
            cam.sensorSize = new Vector2(36f, 24f);
            cam.gateFit = Camera.GateFitMode.Horizontal;
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 200f;

            var hd = go.AddComponent<HDAdditionalCameraData>();

            // The project's default camera frame settings have volumetrics off, so
            // the fog would only attenuate and never scatter — no light shafts. The
            // override lives on the camera rather than in the project defaults
            // because RenderingPathFrameSettings is internal to HDRP.
            hd.customRenderingSettings = true;
            FrameSettingsField[] wanted =
            {
                FrameSettingsField.Volumetrics,
                FrameSettingsField.ReprojectionForVolumetrics,
                FrameSettingsField.AtmosphericScattering,
                FrameSettingsField.SSR,
                FrameSettingsField.SSAO,
                FrameSettingsField.Postprocess,
                FrameSettingsField.ExposureControl,
            };
            foreach (var field in wanted)
            {
                hd.renderingPathCustomFrameSettings.SetEnabled(field, true);
                hd.renderingPathCustomFrameSettingsOverrideMask.mask[(uint)field] = true;
            }
        }

        static void ReportUnassignedMaterials(GameObject geometry)
        {
            var missing = new List<string>();
            foreach (var r in geometry.GetComponentsInChildren<MeshRenderer>(true))
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    if (mats[i] == null)
                    {
                        missing.Add(r.name + "[" + i + "]");
                    }
                }
            }
            if (missing.Count > 0)
            {
                Debug.LogWarning("[WheelStageBuilder] " + missing.Count +
                    " submeshes have no material: " + string.Join(", ", missing.ToArray()));
            }
        }

        static void AddSceneToBuildSettings()
        {
            var scenes = new List<EditorBuildSettingsScene>(EditorBuildSettings.scenes);
            foreach (var s in scenes)
            {
                if (s.path == k_ScenePath) { return; }
            }
            scenes.Insert(0, new EditorBuildSettingsScene(k_ScenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
