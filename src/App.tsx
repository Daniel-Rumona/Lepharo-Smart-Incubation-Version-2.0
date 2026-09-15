// ───────────────────────────────────────────────────────────
// Core Libraries
// ───────────────────────────────────────────────────────────
import {
    BrowserRouter,
    Route,
    Routes,
    Outlet,
    useParams,
    Navigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";

// ───────────────────────────────────────────────────────────
// Refine Core & Utilities
// ───────────────────────────────────────────────────────────
import { Refine, Authenticated } from "@refinedev/core";
import routerProvider, {
    CatchAllNavigate,
    UnsavedChangesNotifier,
    DocumentTitleHandler,
} from "@refinedev/react-router-v6";
import { useNotificationProvider } from "@refinedev/antd";
import { DevtoolsProvider } from "@refinedev/devtools";

// ───────────────────────────────────────────────────────────
// Ant Design
// ───────────────────────────────────────────────────────────
import { ConfigProvider, App as AntdApp } from "antd";
import "@refinedev/antd/dist/reset.css";
import "@/styles/modal-footer.css";
// Loaded last so its html[data-theme="dark"] rules win over the light defaults
// the stylesheets above establish.
import "@/styles/dark-mode.css";
import "@/styles/scrollbars.css";

// ───────────────────────────────────────────────────────────
// App Providers
// ───────────────────────────────────────────────────────────
import { authProvider, dataProvider, liveProvider } from "@/providers";
import { GuideProvider } from "@/components/guide-me";
import { useColorMode } from "@/contexts/ThemeContext";
import { getAntdTheme } from "@/config/antdTheme";
import { applyHighchartsTheme } from "@/lib/highchartsTheme";

// ───────────────────────────────────────────────────────────
// Layout
// ───────────────────────────────────────────────────────────
import { CustomLayout } from "@/components/layout";
import { RouteFallback } from "@/components/layout/RouteFallback";
import ApplicantLayout from "./components/ApplicantLayout";
import { useIdentity } from "@/contexts/IdentityContext";

// ───────────────────────────────────────────────────────────
// Public / Auth Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Admin / System Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Director Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Funder Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Incubatee and applicant routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Coordinator Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Operations Routes
// ───────────────────────────────────────────────────────────
import ConfirmedInterventionsView from "./routes/operations/plan/confirmed";

// ───────────────────────────────────────────────────────────
// Project Admin / Center Coordinator Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Project Manager Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Receptionist Routes
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Shared / Generic Routes
// ───────────────────────────────────────────────────────────
import { ChatSessionProvider } from "@/routes/chat/ChatSessionContext";

// ───────────────────────────────────────────────────────────
// Reporting / Analytics Widgets
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// Hooks / Context / External
// ───────────────────────────────────────────────────────────
import { AuthSessionTracker } from "./components/AuthSessionTracker";
import MandatoryDailyClockIn from "./components/attendance/MandatoryDailyClockIn";
import { LoginPromptProvider } from "./contexts/LoginPromptContext";
import { WhatsNewModal } from "./components/shared/WhatsNewModal";
import { UpdatePrompt } from "@/components/pwa/UpdatePrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { IdleSignOut } from "@/components/auth/IdleSignOut";
import MandatoryMeetingCoverage from "./components/appointments/MandatoryMeetingCoverage";

// ───────────────────────────────────────────────────────────
// Route components, loaded on demand
// ───────────────────────────────────────────────────────────
// Every screen used to be imported eagerly, which put the whole application into
// a single ~11 MB chunk that every user downloaded and parsed before seeing
// anything. These load only when their route is visited. Anything that renders
// on every page -- providers, layouts, the always-mounted components -- stays
// eagerly imported above.
const AdminConsole = lazy(() => import("./routes/admin/backend/console"));
const AdminEmailMonitor = lazy(() => import("./routes/admin/email"));
const AdminLeaveManagement = lazy(() => import("./routes/operations/hr/leave"));
const AllocatedInterventions = lazy(() => import("@/routes/shared/allocated"));
const Allocations = lazy(() => import("./routes/resources/allocations/allocations"));
const ApplicantInquiriesPage = lazy(() => import("./routes/applicant/inquiries"));
const ApplicantInquirySubmission = lazy(() => import("./routes/applicant/submit-inquiry"));
const ApplicantLandingPage = lazy(() => import("./routes/applicant"));
const ApplicantProfileForm = lazy(() => import("./routes/applicant/profile"));
const ApplicationTracker = lazy(() => import("./routes/applicant/tracker"));
const ApplicationsPage = lazy(() => import("./routes/applications"));
const Appointments = lazy(() => import("./routes/shared/appointments"));
const BeneficiariesOverview = lazy(() => import("./routes/directors/reports"));
const BranchManagement = lazy(() => import("@/components/branch-management/BranchManagement").then(m => ({ default: m.BranchManagement })));
const CenterCoordinatorDashboard = lazy(() => import("./routes/projectadmin"));
const CenterCoordinatorFollowUps = lazy(() => import("./routes/projectadmin/follow-ups"));
const Chat = lazy(() => import("@/routes/chat/chat"));
const ClockinPage = lazy(() => import("./routes/shared/timesheet/ClockInPage"));
const CollaborativeReportsModule = lazy(() => import("./routes/operations/reports/collaborative").then(m => ({ default: m.CollaborativeReportsModule })));
const ComplianceDocuments = lazy(() => import("./routes/incubatee/documents/compliance").then(m => ({ default: m.ComplianceDocuments })));
const ComplianceTrackingPage = lazy(() => import("./routes/shared/compliance"));
const ConsolidatedInvoicePacks = lazy(() => import("./routes/operations/inhouse/invoices"));
const ContactsList = lazy(() => import("@/routes/receptionist/contacts"));
const CoordinatorAnalytics = lazy(() => import("@/routes/coordinator/analytics").then(m => ({ default: m.CoordinatorAnalytics })));
const CoordinatorDashboard = lazy(() => import("@/routes/coordinator/CoordinatorDashboard").then(m => ({ default: m.CoordinatorDashboard })));
const CoordinatorMOVApprovals = lazy(() => import("./routes/projectadmin/movs"));
const CoordinatorMOVs = lazy(() => import("./routes/coordinator/movs"));
const CoordinatorPerformance = lazy(() => import("./routes/operations/coordinators/perfomance"));
const CoordinatorTasksAndAppointments = lazy(() => import("./components/tasks/CoordinatorTaskUpdate"));
const CoordinatorsPage = lazy(() => import("./routes/operations/coordinators").then(m => ({ default: m.CoordinatorsPage })));
const DashboardSwitcher = lazy(() => import("./routes/operations/dashboardSwitcher"));
const DataExportPage = lazy(() => import("./routes/data-export"));
const DataExportSettingsPage = lazy(() => import("./routes/admin/data-export-settings"));
const DepartmentManagement = lazy(() => import("@/components/department-management/DepartmentManagement").then(m => ({ default: m.DepartmentManagement })));
const DiagnosticPlanBuilder = lazy(() => import("./routes/operations/plan/diagnostic"));
const DiagnosticPlanConfirmations = lazy(() => import("./routes/operations/plan"));
const DirectorDashboard = lazy(() => import("@/routes/directors/directorDashboard").then(m => ({ default: m.DirectorDashboard })));
const DirectorOnboardingPage = lazy(() => import("./routes/directors/onboarding").then(m => ({ default: m.DirectorOnboardingPage })));
const DocumentationHub = lazy(() => import("./routes/operations/documentation"));
const DocumentsHub = lazy(() => import("./routes/incubatee/documents/hub"));
const EditInquiry = lazy(() => import("@/routes/receptionist/inquiries/[id]/edit"));
const EmployeeLeave = lazy(() => import("./routes/shared/leave"));
const EmployeePerformancePage = lazy(() => import("./routes/operations/hr/performance"));
const EmployeesPage = lazy(() => import("./routes/operations/hr/employees"));
const FeatureGovernancePage = lazy(() => import("./routes/admin/features"));
const FeedbackWorkspace = lazy(() => import("@/routes/coordinator/feedback/FeedbackWorkspace").then(m => ({ default: m.FeedbackWorkspace })));
const FinancePayments = lazy(() => import("./routes/operations/inhouse/payments/FinancePayments"));
const FinanceReports = lazy(() => import("./routes/operations/inhouse/reports/FinanceReports"));
const FinanceRequests = lazy(() => import("./routes/operations/inhouse/requested/FinanceRequest"));
const FollowUpsList = lazy(() => import("@/routes/receptionist/follow-ups"));
const FunderAnalytics = lazy(() => import("@/routes/funder/analytics/funderAnalytics"));
const FunderDashboard = lazy(() => import("@/routes/funder/funderDashboard"));
const GAPAnalysisDetailView = lazy(() => import("./routes/gap/view"));
const GAPAnalysisForm = lazy(() => import("./routes/gap/new/form"));
const GAPAnalysisFormWrapper = lazy(() => import("./components/GAPAnalysisFormWrapper"));
const GAPAnalysisTable = lazy(() => import("./routes/gap"));
const GroupMovementTimeline = lazy(() => import("./routes/operations/groupHistory"));
const GroupProgressForm = lazy(() => import("./routes/incubatee/group"));
const ImpactAnalysisForm = lazy(() => import("./routes/operations/impact").then(m => ({ default: m.ImpactAnalysisForm })));
const IncubateeAnalytics = lazy(() => import("./routes/incubatee/analytics"));
const IncubateeDashboard = lazy(() => import("@/routes/incubatee").then(m => ({ default: m.IncubateeDashboard })));
const IncubateesOverview = lazy(() => import("./routes/funder/smes"));
const InquiriesList = lazy(() => import("@/routes/receptionist/inquiries"));
const InquiryDetailPage = lazy(() => import("@/routes/receptionist/inquiries/[id]"));
const InternalResourceRequestView = lazy(() => import("./routes/resources/internal"));
const InterventionDatabaseView = lazy(() => import("./routes/interventions"));
const InterventionsAssignments = lazy(() => import("./routes/operations/assignments"));
const InterventionsManager = lazy(() => import("./routes/operations/interventions"));
const InterventionsRequests = lazy(() => import("./routes/operations/requests"));
const InterventionsTrackingView = lazy(() => import("./routes/incubatee/interventions"));
const InvoicesView = lazy(() => import("./routes/operations/inhouse/verifications"));
const JobsManagementPage = lazy(() => import("./routes/coordinator/interventions/hse/JobManagement"));
const KPIManager = lazy(() => import("./routes/kpis"));
const KPITrackerView = lazy(() => import("./routes/kpis/KPITrackerView"));
const LandingPage = lazy(() => import("./routes/landing"));
const LeaveCalendar = lazy(() => import("./routes/operations/hr/leave/LeaveCalendar"));
const LibraryPage = lazy(() => import("./routes/shared/library"));
const LoginPage = lazy(() => import("@/routes/login").then(m => ({ default: m.LoginPage })));
const MOAForm = lazy(() => import("./routes/incubatee/moa"));
const MOVApprovalsForm = lazy(() => import("./routes/operations/movs"));
const MarketLinkageManager = lazy(() => import("./routes/coordinator/interventions/linkages"));
const MeetingCheckInPage = lazy(() => import("./components/shared/AppointmentCheckIn"));
const MonitoringActivity = lazy(() => import("./routes/operations/monitoring/activity"));
const MonitoringMOVApprovals = lazy(() => import("./routes/operations/monitoring/movs"));
const MonthlyPerformanceForm = lazy(() => import("@/routes/incubatee/metrics").then(m => ({ default: m.MonthlyPerformanceForm })));
const MyCalendarPage = lazy(() => import("./routes/shared/calendar"));
const NewInquiry = lazy(() => import("@/routes/receptionist/inquiries/new"));
const NotFoundPage = lazy(() => import("./routes/not-found"));
const OperationsInquiriesPage = lazy(() => import("./routes/operations/inquiries"));
const OperationsOnboardingDashboard = lazy(() => import("./routes/directors/operations"));
const OperationsResourceManagement = lazy(() => import("@/routes/operations/resources"));
const ParticipantFormalRegistration = lazy(() => import("./routes/registration/onboarding"));
const ParticipantOnboardingForm = lazy(() => import("./routes/operations/participants/new/ParticipantOnboardingForm"));
const ParticipantSuccess = lazy(() => import("./routes/operations/participants/success"));
const ParticipantsFinancialView = lazy(() => import("./routes/operations/finance").then(m => ({ default: m.ParticipantsFinancialView })));
const ProgramManager = lazy(() => import("./routes/programs"));
const ProjectAdminEditInquiryPage = lazy(() => import("./routes/projectadmin/inquiries/[id]/edit"));
const ProjectAdminInquiryDetailPage = lazy(() => import("./routes/projectadmin/inquiries/[id]"));
const ProjectAdminReports = lazy(() => import("./routes/projectadmin/reports"));
const ProposalPipeline = lazy(() => import("./routes/shared/proposal-pipeline"));
const PurchaseRequestProcessor = lazy(() => import("./routes/projectmanager/inhouse/requests"));
const QualityObjectiveManagement = lazy(() => import("./components/quality-objectives/QualityObjectiveManagement").then(m => ({ default: m.QualityObjectiveManagement })));
const ReceptionistDashboardPage = lazy(() => import("@/routes/receptionist/dashboard"));
const ReceptionistReports = lazy(() => import("@/routes/receptionist/reports"));
const RegisterPage = lazy(() => import("@/routes/registration").then(m => ({ default: m.RegisterPage })));
const ReportSwitcher = lazy(() => import("./routes/operations/reports/reportsSwitcher"));
const RequestedResources = lazy(() => import("./routes/resources/requests/RequestedResources"));
const ResetPasswordPage = lazy(() => import("./routes/reset-password"));
const ResourceRequestForm = lazy(() => import("./routes/incubatee/resources"));
const Resources = lazy(() => import("./routes/resources"));
const RespondSurvey = lazy(() => import("./components/surveys/response"));
const RoadmapFlow = lazy(() => import("./routes/incubatee/roadmap"));
const SMECoverageRegisterPage = lazy(() => import("./routes/operations/reports/monitoring/SMERiskRegister"));
const SMEOverview = lazy(() => import("./routes/shared/incubatees"));
const SmeFeedbackPage = lazy(() => import("./routes/incubatee/feedback"));
const StakeholderEngagementPage = lazy(() => import("./routes/operations/stakeholder"));
const StrategicDashboard = lazy(() => import("./routes/directors/strategic"));
const SuccessChallengesPage = lazy(() => import("./routes/operations/success-challenges"));
const SurveyBuilder = lazy(() => import("./components/surveys/index"));
const CourseBuilder = lazy(() => import("./components/courses/index"));
const CoursesRepository = lazy(() => import("./components/courses/repository"));
const LearnerCoursePage = lazy(() => import("./components/courses/CoursePlayer"));
const AcademyCatalog = lazy(() => import("./components/courses/repository").then(module => ({ default: module.AcademyCatalog })));
const SurveysDetailsPage = lazy(() => import("./components/surveys/SurveysDetails"));
const SystemSetupForm = lazy(() => import("./routes/system"));
const TasksModule = lazy(() => import("./components/tasks/TaskModule"));
const TrainingDashboard = lazy(() => import("@/components/dashboards/training"));
const TutorialsPage = lazy(() => import("./components/shared/TutorialsPage"));
const UserAppointments = lazy(() => import("./routes/incubatee/appointments"));
const UserManagement = lazy(() => import("./components/user-management").then(m => ({ default: m.UserManagement })));
const WelcomeWizard = lazy(() => import("./components/modals/WelcomeWizard"));
const WellnessResponsesPage = lazy(() => import("./routes/coordinator/interventions/pdswellness"));



const AdminOnlyRoute = () => {
    const { actor, loading } = useIdentity();
    if (loading) return null;

    const role = String(actor?.role || "").toLowerCase();
    return ["admin", "system_admin"].includes(role) ? (
        <Outlet />
    ) : (
        <Navigate to="/operations" replace />
    );
};

const queryClient = new QueryClient();

const App = () => {
    const notificationProvider = useNotificationProvider();
    const { mode } = useColorMode();

    // Highcharts colours are inline SVG attributes, so they need a real theme
    // rather than CSS. Applied here so every dashboard picks it up centrally.
    useEffect(() => {
        applyHighchartsTheme(mode);
    }, [mode]);

    // The static APIs — message.success(), Modal.confirm(), notification.open() —
    // render into their own root outside this tree, so they never see the
    // ConfigProvider below and would pop up light on a dark page. holderRender
    // gives that detached root the same theme. Around 160 files call these.
    useEffect(() => {
        ConfigProvider.config({
            holderRender: (children) => (
                <ConfigProvider theme={getAntdTheme(mode)}>{children}</ConfigProvider>
            ),
        });
    }, [mode]);
    const ConfirmedInterventionsWrapper = () => {
        const { participantId, department } = useParams();
        return (
            <ConfirmedInterventionsView
                participantId={participantId as string}
                department={department as string}
            />
        );
    };

    return (
        <>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <ConfigProvider theme={getAntdTheme(mode)}>
                        <AntdApp>
                            <LoginPromptProvider>
                                <AuthSessionTracker />
                                <MandatoryDailyClockIn />
                                <MandatoryMeetingCoverage />
                                <WhatsNewModal />
                                <UpdatePrompt />
                                <OfflineIndicator />
                                <IdleSignOut />
                                <DevtoolsProvider>
                                    <Refine
                                        routerProvider={routerProvider}
                                        dataProvider={dataProvider}
                                        liveProvider={liveProvider}
                                        notificationProvider={notificationProvider}
                                        authProvider={authProvider}
                                        options={{
                                            syncWithLocation: true,
                                            warnWhenUnsavedChanges: true,
                                            liveMode: "auto",
                                            useNewQueryKeys: true,
                                            title: {
                                                text: "Smart Incubation Platform",
                                                icon: null,
                                            },
                                        }}
                                    >
                                        <GuideProvider>
                                            {/* Outer boundary for routes that render outside a layout --
                                                login, landing, registration. Layout-wrapped routes hit the
                                                nearer boundary around each layout's <Outlet />, so their
                                                shell stays on screen while the chunk loads. */}
                                            <Suspense fallback={<RouteFallback />}>
                                                <Routes>
                                                    <Route
                                                        element={
                                                            <Authenticated fallback={<CatchAllNavigate to="/" />}>
                                                                <ChatSessionProvider>
                                                                    <CustomLayout />
                                                                </ChatSessionProvider>
                                                            </Authenticated>
                                                        }
                                                    >
                                                        <Route path="academy" element={<AcademyCatalog />} />
                                                        <Route path="academy/:id" element={<LearnerCoursePage />} />
                                                        {/* System Admin Routes */}
                                                        <Route path="admin" element={<AdminOnlyRoute />}>
                                                            <Route index element={<UserManagement />} />
                                                            <Route path="console" element={<AdminConsole />} />
                                                            <Route path="email" element={<AdminEmailMonitor />} />
                                                            <Route
                                                                path="features"
                                                                element={<FeatureGovernancePage />}
                                                            />
                                                            <Route
                                                                path="data-export-settings"
                                                                element={<DataExportSettingsPage />}
                                                            />
                                                        </Route>
                                                        {/* Project Admin Routes */}
                                                        <Route path="projectadmin">
                                                            <Route
                                                                index
                                                                element={<CenterCoordinatorDashboard />}
                                                            />
                                                            <Route
                                                                path="inquiries"
                                                                element={<ProjectAdminInquiryDetailPage />}
                                                            />
                                                            <Route
                                                                path="inquiries/:id"
                                                                element={<ProjectAdminInquiryDetailPage />}
                                                            />
                                                            <Route
                                                                path="inquiries/:id/edit"
                                                                element={<ProjectAdminEditInquiryPage />}
                                                            />
                                                            <Route
                                                                path="follow-ups"
                                                                element={<CenterCoordinatorFollowUps />}
                                                            />
                                                            <Route
                                                                path="movs"
                                                                element={<CoordinatorMOVApprovals />}
                                                            />
                                                            <Route
                                                                path="reports"
                                                                element={<ProjectAdminReports />}
                                                            />
                                                            <Route
                                                                path="success-challenges"
                                                                element={<SuccessChallengesPage />}
                                                            />
                                                        </Route>
                                                        {/* Director Routes */}
                                                        <Route path="director">
                                                            <Route index element={<DirectorDashboard />} />
                                                            <Route
                                                                path="operators"
                                                                element={<OperationsOnboardingDashboard />}
                                                            />
                                                            <Route
                                                                path="branches"
                                                                element={<BranchManagement />}
                                                            />
                                                            <Route
                                                                path="departments"
                                                                element={<DepartmentManagement />}
                                                            />
                                                            <Route
                                                                path="strategic"
                                                                element={<StrategicDashboard />}
                                                            />
                                                            <Route
                                                                path="reports"
                                                                element={<BeneficiariesOverview />}
                                                            />
                                                            <Route
                                                                path="hr/performance"
                                                                element={<EmployeePerformancePage />}
                                                            />
                                                            <Route
                                                                path="hr/quality-objectives"
                                                                element={<QualityObjectiveManagement />}
                                                            />
                                                        </Route>
                                                        {/* Funder Routes */}
                                                        <Route path="funder">
                                                            <Route index element={<FunderDashboard />} />
                                                            <Route path="smes" element={<IncubateesOverview />} />
                                                            <Route
                                                                path="analytics"
                                                                element={<FunderAnalytics />}
                                                            />
                                                            <Route path="tasks" element={<TasksModule />} />
                                                        </Route>
                                                        {/* Project Manager Routes */}
                                                        <Route path="projectmanager">
                                                            <Route
                                                                path="inhouse/requests"
                                                                element={<PurchaseRequestProcessor />}
                                                            />
                                                        </Route>
                                                        {/* Incubatee Routes */}
                                                        <Route path="incubatee">
                                                            <Route index element={<IncubateeDashboard />} />
                                                            <Route
                                                                path="interventions"
                                                                element={<InterventionsTrackingView />}
                                                            />
                                                            <Route path="group" element={<GroupProgressForm />} />
                                                            <Route path="roadmap" element={<RoadmapFlow />} />
                                                            <Route
                                                                path="appointments"
                                                                element={<UserAppointments />}
                                                            />
                                                            <Route
                                                                path="feedback"
                                                                element={<SmeFeedbackPage />}
                                                            />
                                                            <Route
                                                                path="metrics"
                                                                element={<MonthlyPerformanceForm />}
                                                            />
                                                            <Route
                                                                path="analytics"
                                                                element={<IncubateeAnalytics />}
                                                            />
                                                            <Route
                                                                path="resources"
                                                                element={<ResourceRequestForm />}
                                                            />
                                                            <Route path="library" element={<LibraryPage />} />
                                                            <Route
                                                                path="compliance"
                                                                element={<ComplianceDocuments />}
                                                            />
                                                            <Route
                                                                path="documents/hub"
                                                                element={<DocumentsHub />}
                                                            />
                                                            <Route
                                                                path="surveys/respond/:surveyId"
                                                                element={<RespondSurvey />}
                                                            />
                                                        </Route>

                                                        {/* Coordinator Routes */}
                                                        <Route path="coordinator">
                                                            <Route index element={<CoordinatorDashboard />} />
                                                            <Route
                                                                path="feedback"
                                                                element={<FeedbackWorkspace />}
                                                            />
                                                            <Route
                                                                path="interventions/Linkages"
                                                                element={<MarketLinkageManager />}
                                                            />
                                                            <Route
                                                                path="interventions/wellness"
                                                                element={<WellnessResponsesPage />}
                                                            />
                                                            <Route
                                                                path="tasks"
                                                                element={<CoordinatorTasksAndAppointments />}
                                                            />
                                                            <Route
                                                                path="analytics"
                                                                element={<CoordinatorAnalytics />}
                                                            />
                                                            <Route
                                                                path="allocated/history"
                                                                element={
                                                                    <Navigate to="/coordinator/allocated" replace />
                                                                }
                                                            />
                                                            <Route path="movs" element={<CoordinatorMOVs />} />
                                                            <Route path="allocated">
                                                                <Route
                                                                    index
                                                                    element={<AllocatedInterventions />}
                                                                />
                                                            </Route>
                                                        </Route>

                                                        {/* Operations Routes */}
                                                        <Route path="operations">
                                                            <Route index element={<DashboardSwitcher />} />
                                                            <Route path="library" element={<LibraryPage />} />
                                                            <Route path="participants">
                                                                <Route
                                                                    path="new/:id"
                                                                    element={<ParticipantOnboardingForm />}
                                                                />
                                                                <Route
                                                                    path="participants/risk"
                                                                    element={
                                                                        <SMECoverageRegisterPage parentPadding={24} />
                                                                    }
                                                                />
                                                                <Route
                                                                    path="success"
                                                                    element={<ParticipantSuccess />}
                                                                />
                                                            </Route>
                                                            <Route
                                                                path="stakeholder"
                                                                element={<StakeholderEngagementPage />}
                                                            />
                                                            <Route
                                                                path="hr/leave"
                                                                element={<AdminLeaveManagement />}
                                                            />
                                                            <Route
                                                                path="hr/leave/calendar"
                                                                element={<LeaveCalendar />}
                                                            />
                                                            <Route path="tasks" element={<TasksModule />} />
                                                            <Route
                                                                path="documentation"
                                                                element={<DocumentationHub />}
                                                            />
                                                            <Route
                                                                path="success-challenges"
                                                                element={<SuccessChallengesPage />}
                                                            />
                                                            <Route
                                                                path="hr/employees"
                                                                element={<EmployeesPage />}
                                                            />
                                                            <Route
                                                                path="hr/performance"
                                                                element={<EmployeePerformancePage />}
                                                            />
                                                            <Route
                                                                path="hr/quality-objectives"
                                                                element={<QualityObjectiveManagement />}
                                                            />
                                                            <Route
                                                                path="surveys"
                                                                element={<SurveysDetailsPage />}
                                                            />
                                                            <Route
                                                                path="surveys/builder"
                                                                element={<SurveyBuilder />}
                                                            />
                                                            <Route
                                                                path="surveys/builder/:id"
                                                                element={<SurveyBuilder />}
                                                            />
                                                            <Route
                                                                path="impact"
                                                                element={<ImpactAnalysisForm />}
                                                            />
                                                            <Route
                                                                path="inhouse/requested"
                                                                element={<FinanceRequests />}
                                                            />
                                                            <Route
                                                                path="inhouse/verification"
                                                                element={<InvoicesView />}
                                                            />
                                                            <Route
                                                                path="inhouse/reported"
                                                                element={<FinanceReports />}
                                                            />
                                                            <Route
                                                                path="inhouse/payments"
                                                                element={<FinancePayments />}
                                                            />
                                                            <Route
                                                                path="inhouse/invoices"
                                                                element={<ConsolidatedInvoicePacks />}
                                                            />
                                                            <Route
                                                                path="monitoring/movs"
                                                                element={<MonitoringMOVApprovals />}
                                                            />
                                                            <Route
                                                                path="monitoring/activity"
                                                                element={<MonitoringActivity />}
                                                            />
                                                            <Route
                                                                path="training"
                                                                element={<TrainingDashboard />}
                                                            />
                                                            <Route path="training/courses/builder" element={<CourseBuilder />} />
                                                            <Route path="training/courses/builder/:id" element={<CourseBuilder />} />
                                                            <Route path="training/courses" element={<CoursesRepository />} />
                                                            <Route
                                                                path="requests"
                                                                element={<InterventionsRequests />}
                                                            />
                                                            <Route
                                                                path="plan"
                                                                element={<DiagnosticPlanConfirmations />}
                                                            />
                                                            <Route
                                                                path="diagnostic-plan"
                                                                element={<DiagnosticPlanBuilder />}
                                                            />
                                                            <Route
                                                                path="plan/confirmed/:participantId/:department"
                                                                element={<ConfirmedInterventionsWrapper />}
                                                            />
                                                            <Route
                                                                path="assignments"
                                                                element={<InterventionsAssignments />}
                                                            />
                                                            <Route
                                                                path="/operations/participants/risk"
                                                                element={
                                                                    <SMECoverageRegisterPage parentPadding={24} />
                                                                }
                                                            />
                                                            <Route
                                                                path="interventions"
                                                                element={<InterventionsManager />}
                                                            />
                                                            <Route
                                                                path="finance"
                                                                element={<ParticipantsFinancialView />}
                                                            />
                                                            <Route
                                                                path="groups"
                                                                element={<GroupMovementTimeline />}
                                                            />
                                                            <Route path="gap">
                                                                <Route index element={<GAPAnalysisTable />} />
                                                                {/* This is for adding new */}
                                                                <Route
                                                                    path="new"
                                                                    element={<GAPAnalysisForm mode="rom" />}
                                                                />
                                                                <Route
                                                                    path=":id"
                                                                    element={<GAPAnalysisDetailView />}
                                                                />
                                                            </Route>
                                                            <Route path="coordinators">
                                                                <Route index element={<CoordinatorsPage />} />
                                                                <Route
                                                                    path=":id/performance"
                                                                    element={<CoordinatorPerformance />}
                                                                />
                                                            </Route>
                                                            <Route
                                                                path="resources"
                                                                element={<OperationsResourceManagement />}
                                                            />
                                                            <Route path="movs" element={<MOVApprovalsForm />} />
                                                            <Route
                                                                path="inquiries"
                                                                element={<OperationsInquiriesPage />}
                                                            />
                                                            <Route path="reports" element={<ReportSwitcher />} />
                                                            <Route
                                                                path="reports/collaborative/*"
                                                                element={<CollaborativeReportsModule />}
                                                            />
                                                        </Route>

                                                        {/* Receptionist Routes */}
                                                        <Route path="receptionist">
                                                            <Route
                                                                index
                                                                element={<ReceptionistDashboardPage />}
                                                            />
                                                            <Route path="inquiries" element={<InquiriesList />} />
                                                            <Route
                                                                path="inquiries/new"
                                                                element={<NewInquiry />}
                                                            />
                                                            <Route
                                                                path="inquiries/:id"
                                                                element={<InquiryDetailPage />}
                                                            />
                                                            <Route
                                                                path="inquiries/:id/edit"
                                                                element={<EditInquiry />}
                                                            />
                                                            <Route path="contacts" element={<ContactsList />} />
                                                            <Route
                                                                path="follow-ups"
                                                                element={<FollowUpsList />}
                                                            />
                                                            <Route
                                                                path="reports"
                                                                element={<ReceptionistReports />}
                                                            />
                                                        </Route>

                                                        {/* Shared Routes */}
                                                        <Route
                                                            path="interventions"
                                                            element={<InterventionDatabaseView />}
                                                        />

                                                        <Route
                                                            path="interventions/appointments"
                                                            element={<Appointments />}
                                                        />

                                                        <Route
                                                            path="interventions/assignments"
                                                            element={<InterventionsAssignments />}
                                                        />
                                                        <Route path="kpis">
                                                            <Route path="setup" element={<KPIManager />} />
                                                            <Route path="track" element={<KPITrackerView />} />
                                                        </Route>
                                                        <Route path="participants" element={<SMEOverview />} />
                                                        <Route path="team" element={<UserManagement />} />
                                                        <Route
                                                            path="participants/new/:id"
                                                            element={<ParticipantOnboardingForm />}
                                                        />
                                                        <Route
                                                            path="compliance"
                                                            element={<ComplianceTrackingPage />}
                                                        />
                                                        <Route
                                                            path="metrics/jobs"
                                                            element={<JobsManagementPage />}
                                                        />
                                                        <Route path="calendar" element={<MyCalendarPage />} />
                                                        <Route path="timesheet" element={<ClockinPage />} />
                                                        <Route path="leave" element={<EmployeeLeave />} />
                                                        <Route
                                                            path="data-export"
                                                            element={<DataExportPage />}
                                                        />
                                                        <Route path="tutorials" element={<TutorialsPage />} />
                                                        <Route path="chat" element={<Chat />} />
                                                        <Route path="system" element={<SystemSetupForm />} />

                                                        <Route
                                                            path="applications"
                                                            element={<ApplicationsPage />}
                                                        />
                                                        <Route path="resources">
                                                            <Route index element={<Resources />} />
                                                            <Route
                                                                path="requests"
                                                                element={<RequestedResources />}
                                                            />
                                                            <Route
                                                                path="internal"
                                                                element={<InternalResourceRequestView />}
                                                            />
                                                            <Route path="allocations" element={<Allocations />} />
                                                        </Route>
                                                        <Route path="programs" element={<ProgramManager />} />
                                                        <Route
                                                            path="proposals"
                                                            element={<ProposalPipeline />}
                                                        />
                                                    </Route>
                                                    {/* Applicant portal routes. The user remains an "incubatee" in
                                                Firestore; applicant is a journey stage, not a role. */}
                                                    <Route
                                                        element={
                                                            <Authenticated
                                                                fallback={<CatchAllNavigate to="/login" />}
                                                            >
                                                                <ApplicantLayout />
                                                            </Authenticated>
                                                        }
                                                    >
                                                        <Route path="applicant" element={<ApplicantLandingPage />} />
                                                        <Route
                                                            path="applicant/submit-inquiry"
                                                            element={<ApplicantInquirySubmission />}
                                                        />
                                                        <Route
                                                            path="applicant/inquiries"
                                                            element={<ApplicantInquiriesPage />}
                                                        />
                                                        <Route path="applicant/tracker" element={<ApplicationTracker />} />
                                                        <Route path="applicant/profile" element={<ApplicantProfileForm />} />
                                                    </Route>

                                                    {/* Preserve existing applicant bookmarks and email links. */}
                                                    <Route
                                                        path="applicant/sme"
                                                        element={<Navigate to="/applicant" replace />}
                                                    />
                                                    <Route
                                                        path="applicant/sme/submit-inquiry"
                                                        element={<Navigate to="/applicant/submit-inquiry" replace />}
                                                    />
                                                    <Route
                                                        path="applicant/sme/inquiries"
                                                        element={<Navigate to="/applicant/inquiries" replace />}
                                                    />
                                                    <Route
                                                        path="incubatee/sme"
                                                        element={<Navigate to="/applicant" replace />}
                                                    />
                                                    <Route
                                                        path="incubatee/sme/submit-inquiry"
                                                        element={
                                                            <Navigate
                                                                to="/applicant/submit-inquiry"
                                                                replace
                                                            />
                                                        }
                                                    />
                                                    <Route
                                                        path="incubatee/sme/inquiries"
                                                        element={
                                                            <Navigate to="/applicant/inquiries" replace />
                                                        }
                                                    />
                                                    <Route
                                                        path="incubatee/tracker"
                                                        element={<Navigate to="/applicant/tracker" replace />}
                                                    />
                                                    <Route
                                                        path="incubatee/profile"
                                                        element={<Navigate to="/applicant/profile" replace />}
                                                    />

                                                    <Route path="/" element={<LandingPage />} />
                                                    <Route path="/landing/sme" element={<ApplicantLandingPage />} />
                                                    <Route path="/login" element={<LoginPage />} />
                                                    <Route
                                                        path="/reset-password"
                                                        element={<ResetPasswordPage />}
                                                    />
                                                    <Route path="/welcome" element={<WelcomeWizard />} />
                                                    <Route path="/incubatee/moa" element={<MOAForm />} />
                                                    <Route
                                                        path="/incubatee/gap-analysis"
                                                        element={<GAPAnalysisFormWrapper />}
                                                    />

                                                    <Route
                                                        path="/director/onboarding"
                                                        element={<DirectorOnboardingPage />}
                                                    />
                                                    <Route path="/registration">
                                                        <Route index element={<RegisterPage />} />
                                                        <Route
                                                            path="/registration/onboarding"
                                                            element={<ParticipantFormalRegistration />}
                                                        />
                                                    </Route>

                                                    <Route path="*" element={<NotFoundPage />} />
                                                    <Route
                                                        path="meeting-checkin"
                                                        element={<MeetingCheckInPage />}
                                                    />
                                                </Routes>
                                            </Suspense>

                                            <UnsavedChangesNotifier />
                                            <DocumentTitleHandler />
                                        </GuideProvider>
                                    </Refine>
                                </DevtoolsProvider>
                            </LoginPromptProvider>
                        </AntdApp>
                    </ConfigProvider>
                </BrowserRouter>
            </QueryClientProvider>
        </>
    );
};

export default App;
