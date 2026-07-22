  // ===== Application state =====

  const $ = (id) => document.getElementById(id);

  const colors = [
    "#2b6cb0", "#c05621", "#2f855a", "#805ad5", "#b83280",
    "#0f766e", "#b7791f", "#4a5568", "#dd6b20", "#3182ce",
    "#38a169", "#9f7aea", "#d53f8c", "#319795", "#718096",
    "#e53e3e", "#667eea", "#975a16", "#2c7a7b", "#6b46c1"
  ];

  let variants = [];
  let activeIndex = 0;
  let solveRunId = 0;
  let activeVariantTab = 0;
  const sectionVariantSettings = { edgeWeight: 5 };
  const cornerNames = ["lewy górny", "prawy górny", "dolny"];

  let selectedCellId = null;
  let cellOverrides = {};

  let manualMode = false;
  let manualS = 10;
  let manualP = 16;
  let activeDrawSec = 0;
  let manualVariant = null;
  let manualGridStyle = "honeycomb";
  let manualCellSize = 21;
  let manualCellGap = 1.5;
  let manualGridAngle = 0;
  let manualGridOrigin = { x: 0, y: 0 };
  let manualSelectedCellIds = new Set();
  let manualControllerSelected = false;
  let stage2ActiveSection = 0;
  let stage2ManualMode = false;
  let stage2PaintDrag = null;
  let stage2SuppressClick = false;
  let stage3PolarityReversed = false;
  let stage3BackFlipHorizontal = true;
  let stage3BackFlipVertical = false;
  const stage3NickelConnections = { front: [], back: [] };
  let stage3StripCatalog = { materials: {}, presets: [] };
  let stage3StripSelection = { materialId: "pure_nickel_Ni200", presetId: "strip_0_15x8", width_mm: 8, thickness_mm: 0.15 };
  let stage3CellCatalog = { chemistries: {}, default_spread_percent: {} };
  let stage3CellModel = null;
  let stage3CellProfileDirty = false;
  const savedCellProfilesStorageKey = "ebike-battery-creator.cell-profiles.v1";
  let savedCellProfiles = [];
  let editingCellProfileId = null;
  let cellProfileReturnFocus = null;
  let selectedCellProfileIds = new Set();
  let stage3NickelDrag = null;
  let stage3Notice = "";
  let stage3LastAnalysis = null;
  let stage3LastValidation = null;
  // Generator dwuetapowy buduje jeden układ dla wybranego, wspólnego profilu taśmy.
  let stage3MainLeads = { negative: [], positive: [] };
  let stage3PackPlacementMode = "automatic";
  let stage3ManualPackTarget = null;
  let stage3PackLeadDiagnostics = { negative: null, positive: null };
  let stage3SelectedConnectionId = null;
  let stage3LastPassagePlan = null;
  let stage3OptimizationRunning = false;
  let stage3OptimizationEvaluationCache = null;
  let stage3ShowNodeLabels = false;
  let stage3ShowCurrentLabels = false;
  let stage3NickelHistory = [{ front: [], back: [] }];
  let stage3NickelHistoryIndex = 0;
  let stage2SelectedCellId = null;
  let stage2AssignmentCache = { key: "", cells: [] };
  const stage2AssignmentVariants = new Map();
  const stage2WorkerQueue = [];
  const stage2WorkerPending = new Set();
  let stage2Worker = null;
  let stage2WorkerBusy = false;
  let stage2RecomputeTimer = null;
  let stage2Notice = "";
  let manualDrag = null;
  let autoControllerDrag = null;
  let autoControllerDragFrame = null;
  let autoControllerClickSuppressed = false;
  let autoControllerPreference = null;
  let stage1Substep = 1;
  let stage1DynamicSolveTimer = null;
  let stage2ControllerSolveTimer = null;
  let boundaryType = "triangle";
let manualBoundaryPoints = [];
let manualBoundaryEdges = [];
let manualBoundaryClosed = false;
let manualBoundaryActiveEndpoint = null;
let boundaryReferenceImage = null;
let boundaryImageDrag = null;
let boundaryImageSelected = false;
let boundaryImageLocked = false;
let boundaryImageLastClick = 0;
  let boundaryDrag = null;
  let boundaryClickSuppressed = false;
  let boundaryHistory = [];
  let boundaryHistoryIndex = -1;
  let boundaryEdgeClickTimer = null;
  let placementBoundary = null;
  let workspaceView = { x: -100, y: -100, width: 800, height: 800, zoom: 1 };
  let workspacePan = null;
  let workspacePanJustMoved = false;
  let spacePressed = false;

  let manualHistory = [];
  let manualHistoryIndex = -1;
  let currentStage = 1;
