using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// The machine's display, and nothing else. It is told what to show and never asks how the game is
/// going: no state machine, no paytable, no timers of its own beyond the idle phase it advances.
///
/// The layers it drives are all 2D, sitting on the cabinet's UI anchors. The gold frames, the glass
/// and the cabinet itself are 3D and are not touched here.
/// </summary>
[DisallowMultipleComponent]
public class SlotMachineView : MonoBehaviour
{
    [Header("Reels")]
    [Tooltip("Left, center, right. Their own SlotReelView draws the scrolling content.")]
    [SerializeField] private SlotReelController[] reels = new SlotReelController[SlotMachineResult.ReelCount];

    [Header("Logo")]
    [Tooltip("The flat GOLDEN LUCK artwork.")]
    [SerializeField] private Image logo;

    [Tooltip("The same artwork on an additive material. Its alpha is the pulse.")]
    [SerializeField] private Image logoGlow;

    [Header("Symbol medallions")]
    [Tooltip("The three round symbols above the reels, left to right. Their sprites come from the " +
             "first symbol on each strip, so a reel and its medallion cannot disagree.")]
    [SerializeField] private Image[] symbolMedallions = new Image[SlotMachineResult.ReelCount];

    [Header("Lower display")]
    [Tooltip("The big horseshoe.")]
    [SerializeField] private Image horseshoe;

    [Tooltip("Radial burst behind the horseshoe, additive.")]
    [SerializeField] private Image horseshoeRadialGlow;

    [Tooltip("Glow tracing the horseshoe itself, additive.")]
    [SerializeField] private Image horseshoeInnerGlow;

    [Header("Medallion motion")]
    [Tooltip("How much a medallion grows at the peak of a win.")]
    [SerializeField, Range(0f, 0.5f)] private float medallionPunch = 0.10f;

    private SlotMachineConfig _config;
    private readonly Vector3[] _medallionRestScale = new Vector3[SlotMachineResult.ReelCount];
    private float _idleTime;

    public SlotReelController[] Reels { get { return reels; } }

    /// <summary>
    /// Binds the view to a config: the medallions take the strips' symbols, the reels are
    /// initialised, and the resting brightness of every glow is recorded.
    /// </summary>
    public void Bind(SlotMachineConfig config)
    {
        _config = config;

        for (int i = 0; i < reels.Length; i++)
        {
            if (reels[i] != null)
            {
                reels[i].Initialize(config, i);
            }
        }

        for (int i = 0; i < symbolMedallions.Length; i++)
        {
            var medallion = symbolMedallions[i];
            if (medallion == null)
            {
                continue;
            }

            _medallionRestScale[i] = medallion.transform.localScale;

            var strip = config == null ? null : config.Reel(i);
            var sprite = FirstSymbolSprite(strip);
            if (sprite != null)
            {
                medallion.sprite = sprite;
            }
        }

        ResetVisuals();
    }

    /// <summary>Puts every layer back to its resting look and stops the idle phase.</summary>
    public void ResetVisuals()
    {
        _idleTime = 0f;
        SetLogoGlow(0f);
        SetHorseshoeGlow(_config == null ? 0f : _config.HorseshoeIdleGlow);
        ClearWinHighlight();

        for (int i = 0; i < symbolMedallions.Length; i++)
        {
            if (symbolMedallions[i] != null)
            {
                symbolMedallions[i].transform.localScale = _medallionRestScale[i];
            }
        }
    }

    /// <summary>
    /// Advances the restrained idle look: the logo breathes and the horseshoe glow rises and falls.
    /// Both are slow and shallow on purpose, so the cabinet reads as alive but never as flashing.
    /// </summary>
    public void TickIdle(float deltaTime)
    {
        if (_config == null)
        {
            return;
        }

        _idleTime += deltaTime;

        float logoPhase = Mathf.Sin(_idleTime * Mathf.PI * 2f / _config.LogoPulseSeconds) * 0.5f + 0.5f;
        SetLogoGlow(logoPhase * _config.LogoPulseAmount);

        float shoePhase = Mathf.Sin(_idleTime * Mathf.PI * 2f / _config.HorseshoePulseSeconds) * 0.5f + 0.5f;
        float idle = _config.HorseshoeIdleGlow;
        SetHorseshoeGlow(Mathf.Lerp(idle * 0.6f, idle, shoePhase));
    }

    /// <summary>Alpha of the additive logo layer.</summary>
    public void SetLogoGlow(float amount)
    {
        SetAlpha(logoGlow, amount);
    }

    /// <summary>Brightness of the two horseshoe glow layers. Above 1 is the win peak.</summary>
    public void SetHorseshoeGlow(float amount)
    {
        SetAlpha(horseshoeRadialGlow, amount);
        SetAlpha(horseshoeInnerGlow, amount * 0.85f);

        if (horseshoe != null)
        {
            // The horseshoe is gold, not white, so it brightens rather than washing out.
            float lift = Mathf.Clamp01((amount - 1f) * 0.5f);
            horseshoe.color = Color.Lerp(Color.white, new Color(1f, 0.97f, 0.88f), lift);
        }
    }

    /// <summary>
    /// Lights the reels that took part in the win and grows what they show.
    /// <paramref name="amount"/> ramps the whole reaction from 0 to 1.
    /// </summary>
    public void SetWinHighlight(SlotMachineResult result, float amount)
    {
        float punch = _config == null ? 0f : _config.WinSymbolPunch;

        for (int i = 0; i < reels.Length; i++)
        {
            var reel = reels[i];
            if (reel == null || reel.View == null)
            {
                continue;
            }

            bool matched = result != null && result.IsReelMatched(i);
            reel.View.SetWinHighlight(matched ? amount : 0f);
            reel.View.SetPunch(matched ? punch * amount : 0f);
            // The punch is applied by the layout pass, so nudge it now that the reel is at rest.
            reel.View.SetScroll(reel.Position);

            var medallion = i < symbolMedallions.Length ? symbolMedallions[i] : null;
            if (medallion != null)
            {
                float scale = 1f + (matched ? medallionPunch * amount : 0f);
                medallion.transform.localScale = _medallionRestScale[i] * scale;
            }
        }
    }

    /// <summary>Takes every reel and medallion back to its resting look.</summary>
    public void ClearWinHighlight()
    {
        SetWinHighlight(null, 0f);
    }

    /// <summary>What the view is missing, appended to <paramref name="problems"/>.</summary>
    public void CollectProblems(List<string> problems)
    {
        if (problems == null)
        {
            return;
        }

        if (reels == null || reels.Length != SlotMachineResult.ReelCount)
        {
            problems.Add("View: expected " + SlotMachineResult.ReelCount + " reels.");
        }
        else
        {
            var names = new[] { "Reel_Left", "Reel_Center", "Reel_Right" };
            for (int i = 0; i < reels.Length; i++)
            {
                if (reels[i] == null)
                {
                    problems.Add("View: " + names[i] + " is not wired.");
                    continue;
                }

                if (reels[i].View == null)
                {
                    problems.Add("View: " + names[i] + " has no SlotReelView.");
                    continue;
                }

                reels[i].View.CollectProblems(problems, names[i]);
            }
        }

        if (logo == null)
        {
            problems.Add("View: no logo image.");
        }

        if (horseshoe == null)
        {
            problems.Add("View: no horseshoe image on the lower display.");
        }

        for (int i = 0; i < symbolMedallions.Length; i++)
        {
            if (symbolMedallions[i] == null)
            {
                problems.Add("View: symbol medallion " + i + " is not wired.");
            }
        }
    }

    private static Sprite FirstSymbolSprite(SlotReelStrip strip)
    {
        if (strip == null)
        {
            return null;
        }

        for (int i = 0; i < strip.Count; i++)
        {
            var item = strip.items[i];
            if (item.kind == SlotReelItemKind.Symbol && item.sprite != null)
            {
                return item.sprite;
            }
        }

        return null;
    }

    private static void SetAlpha(Image image, float alpha)
    {
        if (image == null)
        {
            return;
        }

        var color = image.color;
        color.a = Mathf.Max(0f, alpha);
        image.color = color;
    }
}
