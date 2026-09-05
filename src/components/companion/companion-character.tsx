import type { CSSProperties } from "react";
import type { CompanionStateId, OutfitId, HairId } from "./companion-config";
import { COMPANION_OUTFITS, COMPANION_HAIR } from "./companion-config";

// The mascot itself — one inline SVG, no image assets, no canvas library.
// Moved here from src/app/dashboard/companion-preview/companion.tsx on
// 2026-09-05 (renamed Companion -> CompanionCharacter) so the live widget
// and the preview/mockup page share one definition. Everything visual
// (pose, face, decorations) is driven off `state`; the wardrobe props only
// ever recolor/reshape shapes that are already part of the base drawing
// (never add a free-form layer), matching the "small fixed wardrobe, not a
// dress-up system" ask — glasses (new 2026-09-05) is the one exception,
// since it's an on/off overlay rather than a recolor.
//
// Animation is applied via CSS classes keyed off `data-companion-state` on
// the outer <g> (see the .oms-companion-* rules in globals.css) rather than
// inline @keyframes, so the reduced-motion override lives in one place
// alongside every other animation in the app.

const SKIN = "#ffcf8a";
const SKIN_SHADE = "#f0b464";
const BELLY = "#fff1d6";
const INK = "#3a2416";
const HAIR_COLOR = "#5b3a29";

// Arm rotation (degrees) around each shoulder pivot, per state. The arm is
// drawn hanging straight down at rest; negative rotates the left arm
// up/out, positive the mirrored right arm up/out (see renderArm below).
const ARM_POSE: Record<CompanionStateId, { left: number; right: number }> = {
  punch_in: { left: -95, right: 95 },
  task_completed: { left: -130, right: 70 },
  overdue: { left: 18, right: -18 },
  idle_night: { left: 28, right: -22 },
  focused: { left: 6, right: -6 },
};

interface CompanionCharacterProps {
  state: CompanionStateId;
  outfit: OutfitId;
  hair: HairId;
  glasses?: boolean;
  className?: string;
}

export function CompanionCharacter({ state, outfit, hair, glasses = false, className }: CompanionCharacterProps) {
  const outfitConfig = COMPANION_OUTFITS.find((o) => o.id === outfit) ?? COMPANION_OUTFITS[0];
  const hairConfig = COMPANION_HAIR.find((h) => h.id === hair) ?? COMPANION_HAIR[0];
  const pose = ARM_POSE[state];

  return (
    <svg
      viewBox="0 0 200 240"
      className={className}
      role="img"
      aria-label={`Companion mascot, currently ${state.replace(/_/g, " ")}, wearing ${outfitConfig.label} with ${hairConfig.label} hair`}
      data-companion-state={state}
    >
      {/* Soft aura behind the character — color is set inline per state via
          --companion-aura on the wrapper, so this shape just reads the
          variable rather than hardcoding a color per state itself. */}
      <circle cx={100} cy={130} r={92} fill="var(--companion-aura, transparent)" opacity={0.16} className="oms-companion-aura" />

      {renderBackDecor(state)}

      <g className="oms-companion-body-group">
        {/* Shoes */}
        <ellipse cx={78} cy={210} rx={17} ry={11} fill={outfitConfig.shoeColor} />
        <ellipse cx={122} cy={210} rx={17} ry={11} fill={outfitConfig.shoeColor} />

        {/* Arms (drawn behind the body so only the lower "hand" half peeks
            out past the torso silhouette) */}
        {renderArm(42, 128, pose.left, "left")}
        {renderArm(158, 128, pose.right, "right")}

        {/* Body */}
        <ellipse cx={100} cy={140} rx={58} ry={62} fill={SKIN} stroke={SKIN_SHADE} strokeWidth={2} />
        <ellipse cx={100} cy={162} rx={32} ry={34} fill={BELLY} opacity={0.8} />

        {/* Outfit overlay: a rounded vest/bib shape + a seam + two buttons,
            all recolored per outfit — this is the entire "wardrobe" effect
            on the body, no extra layers are added between outfits. */}
        <path
          d="M70,132 Q100,120 130,132 L138,196 Q100,212 62,196 Z"
          fill={outfitConfig.vestColor}
        />
        <line x1={100} y1={126} x2={100} y2={206} stroke={outfitConfig.vestShade} strokeWidth={3} opacity={0.55} />
        <circle cx={100} cy={150} r={3.4} fill={outfitConfig.vestShade} />
        <circle cx={100} cy={166} r={3.4} fill={outfitConfig.vestShade} />

        {renderHair(hair)}
        {renderFace(state)}
        {glasses ? renderGlasses() : null}
      </g>

      {renderFrontDecor(state)}
    </svg>
  );
}

function renderArm(shoulderX: number, shoulderY: number, rotateDeg: number, side: "left" | "right") {
  const dx = side === "left" ? -16 : 16;
  const style: CSSProperties = {
    transformOrigin: `${shoulderX}px ${shoulderY}px`,
    transform: `rotate(${rotateDeg}deg)`,
  };
  return (
    <line
      x1={shoulderX}
      y1={shoulderY}
      x2={shoulderX + dx}
      y2={shoulderY + 44}
      stroke={SKIN}
      strokeWidth={17}
      strokeLinecap="round"
      style={style}
      className="oms-companion-arm"
    />
  );
}

function renderHair(hair: HairId) {
  if (hair === "spike") {
    return (
      <g fill={HAIR_COLOR}>
        <polygon points="72,82 80,46 88,82" />
        <polygon points="90,78 100,36 110,78" />
        <polygon points="112,82 120,46 128,82" />
      </g>
    );
  }
  if (hair === "wavy") {
    // 2026-09-05 — shoulder-length wavy hair (reference photos): a wider
    // crown + two long wavy side-locks framing the face down past the
    // shoulders, drawn with alternating S-curves for the "wavy" silhouette
    // rather than curl's tight interior loops.
    return (
      <g fill={HAIR_COLOR}>
        <path d="M62,78 C58,44 82,26 100,26 C118,26 142,44 138,78 C132,66 122,58 100,58 C78,58 68,66 62,78 Z" />
        <path d="M58,80 C48,96 50,120 46,140 C58,132 62,112 66,96 C64,132 58,158 50,178 C64,168 74,138 76,108 C74,98 66,86 58,80 Z" />
        <path d="M142,80 C152,96 150,120 154,140 C142,132 138,112 134,96 C136,132 142,158 150,178 C136,168 126,138 124,108 C126,98 134,86 142,80 Z" />
      </g>
    );
  }
  // curl
  return (
    <path
      d="M90,72 C74,64 78,40 98,42 C114,44 116,60 104,64 C112,68 108,80 96,76 C100,80 96,84 90,80 Z"
      fill={HAIR_COLOR}
    />
  );
}

function renderGlasses() {
  // 2026-09-05 — round-frame glasses overlay (reference photos), drawn
  // once, independent of `state` — sits above the face at the fixed eye
  // spacing every face variant below uses (leftX=78, rightX=122, eyeY=128).
  return (
    <g className="oms-companion-glasses" fill="none" stroke="#3a2416" strokeWidth={3} opacity={0.85}>
      <circle cx={78} cy={128} r={17} />
      <circle cx={122} cy={128} r={17} />
      <line x1={95} y1={126} x2={105} y2={126} />
      <line x1={61} y1={124} x2={50} y2={120} strokeLinecap="round" />
      <line x1={139} y1={124} x2={150} y2={120} strokeLinecap="round" />
    </g>
  );
}

function renderFace(state: CompanionStateId) {
  const leftX = 78;
  const rightX = 122;
  const eyeY = 128;

  switch (state) {
    case "punch_in":
      return (
        <g>
          <path d={brow(leftX, eyeY - 18, -8)} stroke={INK} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          <path d={brow(rightX, eyeY - 18, 8)} stroke={INK} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          {eyeCircle(leftX, eyeY, 14, true)}
          {eyeCircle(rightX, eyeY, 14, true)}
          <path
            d="M76,150 Q100,180 124,150 L120,150 Q100,168 80,150 Z"
            fill="#8a3b1f"
          />
        </g>
      );
    case "task_completed":
      return (
        <g>
          <path d={happyArc(leftX)} stroke={INK} strokeWidth={4.5} fill="none" strokeLinecap="round" className="oms-companion-cheer-eye" />
          <path d={happyArc(rightX)} stroke={INK} strokeWidth={4.5} fill="none" strokeLinecap="round" className="oms-companion-cheer-eye" />
          <ellipse cx={leftX} cy={eyeY + 10} rx={7} ry={4} fill="#ff9d7a" opacity={0.7} />
          <ellipse cx={rightX} cy={eyeY + 10} rx={7} ry={4} fill="#ff9d7a" opacity={0.7} />
          <path d="M78,150 Q100,184 122,150 Q100,172 78,150 Z" fill="#8a3b1f" />
        </g>
      );
    case "overdue":
      return (
        <g>
          <line x1={leftX - 12} y1={eyeY - 20} x2={leftX + 6} y2={eyeY - 12} stroke={INK} strokeWidth={4} strokeLinecap="round" />
          <line x1={rightX + 12} y1={eyeY - 20} x2={rightX - 6} y2={eyeY - 12} stroke={INK} strokeWidth={4} strokeLinecap="round" />
          {eyeCircle(leftX, eyeY, 10, false)}
          {eyeCircle(rightX, eyeY, 10, false)}
          <path d="M84,166 Q100,156 116,166" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
        </g>
      );
    case "idle_night":
      return (
        <g>
          <path d={`M66,${eyeY} Q78,${eyeY + 5} 90,${eyeY}`} stroke={INK} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          <path d={`M110,${eyeY} Q122,${eyeY + 5} 134,${eyeY}`} stroke={INK} strokeWidth={3.5} fill="none" strokeLinecap="round" />
          <ellipse cx={100} cy={160} rx={7} ry={9} fill="#8a3b1f" />
        </g>
      );
    case "focused":
    default:
      return (
        <g>
          {eyeCircle(leftX, eyeY, 11, false, true)}
          {eyeCircle(rightX, eyeY, 11, false, true)}
          <path d="M86,154 Q100,161 114,154" stroke={INK} strokeWidth={3} fill="none" strokeLinecap="round" />
        </g>
      );
  }
}

function eyeCircle(cx: number, cy: number, r: number, wide: boolean, blinking = false) {
  return (
    <g key={`${cx}-eye`}>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="#e7c9a3" strokeWidth={1.5} />
      <circle cx={cx} cy={cy + (wide ? 1 : 2)} r={wide ? r * 0.55 : r * 0.48} fill={INK} />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 0.18} fill="#fff" />
      {blinking ? (
        <rect
          x={cx - r - 1}
          y={cy - r - 1}
          width={r * 2 + 2}
          height={r * 2 + 2}
          fill={SKIN}
          className="oms-companion-eyelid"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
        />
      ) : null}
    </g>
  );
}

function brow(cx: number, cy: number, tilt: number) {
  const dir = tilt < 0 ? -1 : 1;
  return `M${cx - 12},${cy + (dir < 0 ? 4 : -4)} Q${cx},${cy - 6} ${cx + 12},${cy + (dir < 0 ? -4 : 4)}`;
}

function happyArc(cx: number) {
  return `M${cx - 13},${132} Q${cx},${116} ${cx + 13},${132}`;
}

function renderBackDecor(state: CompanionStateId) {
  if (state !== "punch_in") return null;
  // A few short "energy" rays behind the body for the punch-in state.
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g className="oms-companion-rays" stroke="#f59e0b" strokeWidth={4} strokeLinecap="round" opacity={0.55}>
      {rays.map((deg) => (
        <line
          key={deg}
          x1={100}
          y1={140}
          x2={100}
          y2={62}
          style={{ transformOrigin: "100px 140px", transform: `rotate(${deg}deg)` }}
        />
      ))}
    </g>
  );
}

function renderFrontDecor(state: CompanionStateId) {
  switch (state) {
    case "task_completed":
      return (
        <g className="oms-companion-sparkles" fill="#f59e0b">
          <Sparkle x={40} y={54} size={10} delay="0s" />
          <Sparkle x={166} y={44} size={8} delay="0.25s" />
          <Sparkle x={150} y={90} size={7} delay="0.5s" />
          <Sparkle x={30} y={96} size={6} delay="0.75s" />
        </g>
      );
    case "overdue":
      return (
        <g>
          <path
            d="M148,84 C154,94 148,104 142,102 C136,100 138,88 148,84 Z"
            fill="#7dd3fc"
            className="oms-companion-sweat"
          />
          <g className="oms-companion-alert" style={{ transformOrigin: "100px 30px" }}>
            <circle cx={100} cy={30} r={14} fill="#ef4444" />
            <text x={100} y={35} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff">
              !
            </text>
          </g>
        </g>
      );
    case "idle_night":
      return (
        <g>
          <path d="M160,32 a12,12 0 1 0 0.2,0 a9,9 0 1 1 -0.2,0" fill="#c7d2fe" opacity={0.9} />
          <text x={30} y={40} fontSize={14} fill="#818cf8" className="oms-companion-zzz" style={{ animationDelay: "0s" }}>
            Z
          </text>
          <text x={42} y={26} fontSize={11} fill="#a5b4fc" className="oms-companion-zzz" style={{ animationDelay: "0.6s" }}>
            z
          </text>
          <text x={52} y={16} fontSize={8} fill="#c7d2fe" className="oms-companion-zzz" style={{ animationDelay: "1.2s" }}>
            z
          </text>
        </g>
      );
    default:
      return null;
  }
}

function Sparkle({ x, y, size, delay }: { x: number; y: number; size: number; delay: string }) {
  const s = size;
  return (
    <polygon
      points={`${x},${y - s} ${x + s * 0.28},${y - s * 0.28} ${x + s},${y} ${x + s * 0.28},${y + s * 0.28} ${x},${y + s} ${x - s * 0.28},${y + s * 0.28} ${x - s},${y} ${x - s * 0.28},${y - s * 0.28}`}
      className="oms-companion-sparkle"
      style={{ animationDelay: delay, transformOrigin: `${x}px ${y}px` }}
    />
  );
}
