import { EventEmitter } from "events";
import { DepartmentAgent } from "../types/department-agent.types";
import { CitizenNeed } from "../types/citizen.types";
import { TogetherService } from "./together.service";
import { AnalyticsService } from "./analytics.service";
import { DepartmentService } from "./department.service";
import { MetricsService } from "./metrics.service";
import { VectorStoreService } from "./vector-store.service";
import { Agent } from "../types/agent.types";

interface AgentTaskUpdate {
  agentId: string;
  task: NonNullable<DepartmentAgent["currentTask"]>;
}

export class DepartmentAgentService extends EventEmitter {
  private agents: Map<string, DepartmentAgent> = new Map();

  constructor(
    private togetherService: TogetherService,
    private analyticsService: AnalyticsService,
    private departmentService: DepartmentService,
    private metricsService: MetricsService,
    private vectorStore: VectorStoreService
  ) {
    super();
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Listen for department agent updates
    this.departmentService.on(
      "agentAssigned",
      ({
        departmentId,
        agent,
      }: {
        departmentId: string;
        agent: DepartmentAgent;
      }) => {
        this.agents.set(agent.id, agent);
        this.analyticsService.trackEvent("agent_registered", {
          agentId: agent.id,
          departmentId,
          timestamp: Date.now(),
        });
      }
    );

    this.departmentService.on(
      "agentsHealthUpdated",
      ({
        departmentId,
        agents,
      }: {
        departmentId: string;
        agents: DepartmentAgent[];
      }) => {
        agents.forEach((agent) => {
          if (this.agents.has(agent.id)) {
            this.agents.set(agent.id, agent);
          }
        });
      }
    );
  }

  async handleCitizenNeed(need: CitizenNeed) {
    const availableAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.schedule.availability && !agent.currentTask
    );

    if (availableAgents.length === 0) {
      this.analyticsService.trackEvent("no_available_agents", {
        needType: need.type,
        urgency: need.urgency,
        timestamp: Date.now(),
      });
      return;
    }

    const agent = this.selectBestAgent(availableAgents, need);
    await this.assignTask(agent.id, {
      type: "citizen_request",
      description: need.description,
      priority:
        need.urgency > 0.7 ? "high" : need.urgency > 0.3 ? "medium" : "low",
    });

    // Update metrics
    await this.metricsService.updateMetrics({
      social: {
        healthcareAccessScore: agent.performance.efficiency,
        educationQualityIndex: 0.8,
        communityWellbeing: agent.performance.citizenSatisfaction,
      },
    });
  }

  private selectBestAgent(
    agents: DepartmentAgent[],
    need: CitizenNeed
  ): DepartmentAgent {
    const selectedAgent = agents.reduce((best, current) => {
      const score =
        current.performance.responseTime * 0.4 +
        current.performance.resolutionRate * 0.4 +
        current.performance.efficiency * 0.2;
      const bestScore =
        best.performance.responseTime * 0.4 +
        best.performance.resolutionRate * 0.4 +
        best.performance.efficiency * 0.2;
      return score > bestScore ? current : best;
    });

    this.analyticsService.trackEvent("agent_selected", {
      agentId: selectedAgent.id,
      needType: need.type,
      urgency: need.urgency,
      score: selectedAgent.performance.efficiency,
      timestamp: Date.now(),
    });

    return selectedAgent;
  }

  private async assignTask(
    agentId: string,
    task: NonNullable<DepartmentAgent["currentTask"]>
  ) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.currentTask = task;
    this.agents.set(agentId, agent);

    this.analyticsService.trackEvent("task_assigned", {
      agentId,
      taskType: task.type,
      priority: task.priority,
      timestamp: Date.now(),
    });

    this.emit("taskAssigned", { agentId, task });
  }

  async getAgentTasks(departmentId: string): Promise<AgentTaskUpdate[]> {
    const agents = await this.departmentService.getDepartmentAgents(
      departmentId
    );
    return agents
      .filter(
        (
          agent
        ): agent is DepartmentAgent & {
          currentTask: NonNullable<DepartmentAgent["currentTask"]>;
        } => agent.currentTask !== null && agent.currentTask !== undefined
      )
      .map((agent) => ({
        agentId: agent.id,
        task: agent.currentTask,
      }));
  }

  async registerAgent(agent: Agent): Promise<void> {
    try {
      // Create embedding for agent data
      const embedding = await this.togetherService.createEmbedding(
        `${agent.role} ${agent.personality} ${agent.interests.join(" ")}`
      );

      // Store agent data in Pinecone
      await this.vectorStore.upsert({
        id: `agent-${agent.id}`,
        values: embedding,
        metadata: {
          type: "department_agent",
          agentId: agent.id,
          role: agent.role,
          name: agent.name,
          personality: agent.personality,
          interests: agent.interests.join(","),
          traits: JSON.stringify(agent.traits),
          department: agent.department || "general",
          timestamp: Date.now(),
        },
      });

      // Track agent registration
      this.analyticsService.trackEvent("agent_registered", {
        agentId: agent.id,
        role: agent.role,
        department: agent.department || "general",
      });

      console.log(
        `✅ Registered department agent: ${agent.name} in ${
          agent.department || "general"
        } department`
      );
    } catch (error) {
      console.error(`Failed to register agent ${agent.name}:`, error);
      throw error;
    }
  }
}
