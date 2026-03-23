import { create } from "zustand";
import { FormAnswers, Submission, SubmissionSummary, LeadStatus, Question } from "@/types";
import { TenantConfig } from "@/types/tenant";
import { generateSummary } from "@/lib/recommendations";
import { demoSubmissions } from "@/lib/demo-submissions";
import { v4 as uuidv4 } from "uuid";

function sanitizeAnswers(answers: FormAnswers): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (Array.isArray(value) && value.length > 0 && value[0] instanceof File) {
      sanitized[key] = null;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

interface TenantFormState {
  tenantSlug: string;
  tenantQuestions: Question[];
  currentStep: number;
  answers: FormAnswers;
  isComplete: boolean;
  submissions: Submission[];
  currentSubmission: Submission | null;
  isLoadingSubmissions: boolean;

  init: (config: TenantConfig) => void;
  setAnswer: (questionId: string, value: string | string[] | File[] | null) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  getVisibleQuestions: () => Question[];
  submitForm: () => void;
  resetForm: () => void;
  loadSubmissions: () => Promise<void>;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  deleteSubmission: (id: string) => void;
}

function filterVisibleQuestions(questions: Question[], answers: FormAnswers) {
  return questions.filter((q) => {
    if (!q.condition) return true;
    const depAnswer = answers[q.condition.questionId];
    if (!depAnswer) return false;
    const condValues = Array.isArray(q.condition.value)
      ? q.condition.value
      : [q.condition.value];
    if (Array.isArray(depAnswer)) {
      return depAnswer.some((a) => condValues.includes(a as string));
    }
    return condValues.includes(depAnswer as string);
  });
}

export const useTenantFormStore = create<TenantFormState>()((set, get) => ({
  tenantSlug: "",
  tenantQuestions: [],
  currentStep: -1,
  answers: {},
  isComplete: false,
  submissions: [],
  currentSubmission: null,
  isLoadingSubmissions: false,

  init: (config) => {
    if (get().tenantSlug === config.slug && get().tenantQuestions.length > 0) return;
    set({
      tenantSlug: config.slug,
      tenantQuestions: config.questions,
      currentStep: -1,
      answers: {},
      isComplete: false,
      currentSubmission: null,
    });
  },

  setAnswer: (questionId, value) => {
    set((state) => ({
      answers: { ...state.answers, [questionId]: value },
    }));
  },

  nextStep: () => {
    const { currentStep } = get();
    const visible = get().getVisibleQuestions();
    if (currentStep < visible.length - 1) {
      set({ currentStep: currentStep + 1 });
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 });
    } else if (currentStep === 0) {
      set({ currentStep: -1 });
    }
  },

  goToStep: (step) => set({ currentStep: step }),

  getVisibleQuestions: () => filterVisibleQuestions(get().tenantQuestions, get().answers),

  submitForm: () => {
    const { answers, tenantSlug } = get();
    const summary: SubmissionSummary = generateSummary(answers);
    const submission: Submission = {
      id: uuidv4(),
      answers: { ...answers },
      summary,
      status: "new",
      createdAt: new Date().toISOString(),
      businessName: (answers.business_name as string) || "Unnamed Business",
    };
    set({
      currentSubmission: submission,
      isComplete: true,
    });

    fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: tenantSlug,
        submission: {
          ...submission,
          answers: sanitizeAnswers(submission.answers),
          tenantSlug,
        },
      }),
    })
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) console.error("API error:", result.error);
      })
      .catch((err) => console.error("Failed to save submission:", err));
  },

  resetForm: () =>
    set({
      currentStep: -1,
      answers: {},
      isComplete: false,
      currentSubmission: null,
    }),

  loadSubmissions: async () => {
    const { tenantSlug } = get();
    set({ isLoadingSubmissions: true });
    try {
      const res = await fetch(`/api/submissions?slug=${tenantSlug}`);
      const result = await res.json();

      if (result.success && result.submissions && result.submissions.length > 0) {
        set({ submissions: result.submissions as Submission[], isLoadingSubmissions: false });
      } else if (tenantSlug === "demo") {
        // Seed demo data if empty
        set({ submissions: demoSubmissions, isLoadingSubmissions: false });
        // Persist in background
        for (const sub of demoSubmissions) {
          fetch("/api/submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: "demo", submission: sub }),
          }).catch(() => {});
        }
      } else {
        set({ submissions: [], isLoadingSubmissions: false });
      }
    } catch (err) {
      console.error("Failed to load submissions:", err);
      if (tenantSlug === "demo") {
        set({ submissions: demoSubmissions, isLoadingSubmissions: false });
      } else {
        set({ isLoadingSubmissions: false });
      }
    }
  },

  updateLeadStatus: (id, status) => {
    const { tenantSlug } = get();
    set((state) => ({
      submissions: state.submissions.map((s) =>
        s.id === id ? { ...s, status } : s
      ),
    }));
    fetch("/api/submissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: tenantSlug, id, status }),
    }).catch((err) => console.error("Failed to update status:", err));
  },

  deleteSubmission: (id) => {
    const { tenantSlug } = get();
    set((state) => ({
      submissions: state.submissions.filter((s) => s.id !== id),
    }));
    fetch("/api/submissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: tenantSlug, id }),
    }).catch((err) => console.error("Failed to delete submission:", err));
  },
}));
