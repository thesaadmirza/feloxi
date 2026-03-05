use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// A node in the task workflow DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagNode {
    pub task_id: String,
    pub task_name: String,
    pub state: String,
    pub runtime: Option<f64>,
    pub queue: String,
    pub worker_id: String,
    pub group_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub chord_id: Option<String>,
}

/// An edge in the workflow DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagEdge {
    pub source: String,
    pub target: String,
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EdgeType {
    Chain,
    Group,
    Chord,
    Callback,
}

/// Complete workflow DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDag {
    pub root_id: String,
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

/// Build a DAG from task events.
/// Given a list of tasks that share a root_id, reconstruct the workflow structure.
pub fn build_dag(tasks: Vec<DagNode>) -> WorkflowDag {
    if tasks.is_empty() {
        return WorkflowDag { root_id: String::new(), nodes: vec![], edges: vec![] };
    }

    let root_id = tasks[0].task_id.clone();
    let mut edges = Vec::new();
    let mut task_map: HashMap<String, &DagNode> = HashMap::new();

    for task in &tasks {
        task_map.insert(task.task_id.clone(), task);
    }

    // Group tasks by group_id
    let mut groups: HashMap<String, Vec<&DagNode>> = HashMap::new();
    for task in &tasks {
        if let Some(gid) = &task.group_id {
            groups.entry(gid.clone()).or_default().push(task);
        }
    }

    let task_ids: HashSet<String> = tasks.iter().map(|t| t.task_id.clone()).collect();
    let mut connected: HashSet<String> = HashSet::new();

    // 1. Parent-child chain edges (most reliable signal from Celery)
    for task in &tasks {
        if let Some(pid) = &task.parent_id {
            if task_ids.contains(pid) {
                edges.push(DagEdge {
                    source: pid.clone(),
                    target: task.task_id.clone(),
                    edge_type: EdgeType::Chain,
                });
                connected.insert(task.task_id.clone());
                connected.insert(pid.clone());
            }
        }
    }

    // 2. Group edges (tasks sharing group_id run in parallel)
    for members in groups.values() {
        for i in 0..members.len() {
            for j in (i + 1)..members.len() {
                edges.push(DagEdge {
                    source: members[i].task_id.clone(),
                    target: members[j].task_id.clone(),
                    edge_type: EdgeType::Group,
                });
                connected.insert(members[i].task_id.clone());
                connected.insert(members[j].task_id.clone());
            }
        }
    }

    // 3. Chord edges (chord_id links a group to its callback task)
    let mut chord_targets: HashMap<String, Vec<String>> = HashMap::new();
    for task in &tasks {
        if let Some(cid) = &task.chord_id {
            chord_targets.entry(cid.clone()).or_default().push(task.task_id.clone());
        }
    }
    for (chord_id, group_members) in &chord_targets {
        // The chord callback is the task whose task_id matches the chord_id,
        // or if not found, any task with this chord_id that isn't in a group
        if let Some(callback) = tasks.iter().find(|t| {
            t.task_id == *chord_id
                || (t.group_id.is_none() && t.chord_id.as_deref() == Some(chord_id))
        }) {
            for member_id in group_members {
                if *member_id != callback.task_id {
                    edges.push(DagEdge {
                        source: member_id.clone(),
                        target: callback.task_id.clone(),
                        edge_type: EdgeType::Chord,
                    });
                    connected.insert(member_id.clone());
                    connected.insert(callback.task_id.clone());
                }
            }
        }
    }

    // 4. Fallback: heuristic chain for unconnected non-group tasks (sorted by task_id)
    let mut unconnected: Vec<&DagNode> =
        tasks.iter().filter(|t| !connected.contains(&t.task_id) && t.group_id.is_none()).collect();
    unconnected.sort_by(|a, b| a.task_id.cmp(&b.task_id));

    for window in unconnected.windows(2) {
        edges.push(DagEdge {
            source: window[0].task_id.clone(),
            target: window[1].task_id.clone(),
            edge_type: EdgeType::Chain,
        });
    }

    WorkflowDag { root_id, nodes: tasks, edges }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_node(id: &str, name: &str, group_id: Option<&str>) -> DagNode {
        DagNode {
            task_id: id.to_string(),
            task_name: name.to_string(),
            state: "SUCCESS".to_string(),
            runtime: Some(1.0),
            queue: "default".to_string(),
            worker_id: "w1".to_string(),
            group_id: group_id.map(|s| s.to_string()),
            parent_id: None,
            chord_id: None,
        }
    }

    fn make_node_with_parent(id: &str, name: &str, parent_id: Option<&str>) -> DagNode {
        DagNode {
            task_id: id.to_string(),
            task_name: name.to_string(),
            state: "SUCCESS".to_string(),
            runtime: Some(1.0),
            queue: "default".to_string(),
            worker_id: "w1".to_string(),
            group_id: None,
            parent_id: parent_id.map(|s| s.to_string()),
            chord_id: None,
        }
    }

    // ─── Single task ───────────────────────────────────────────

    #[test]
    fn build_dag_single_task() {
        let dag = build_dag(vec![make_node("t1", "add", None)]);
        assert_eq!(dag.root_id, "t1");
        assert_eq!(dag.nodes.len(), 1);
        assert!(dag.edges.is_empty());
    }

    // ─── Chain (no groups) ─────────────────────────────────────

    #[test]
    fn build_dag_chain_two_tasks() {
        let tasks = vec![make_node("a", "task_a", None), make_node("b", "task_b", None)];
        let dag = build_dag(tasks);
        assert_eq!(dag.root_id, "a");
        assert_eq!(dag.nodes.len(), 2);
        // Two tasks without groups, sorted by task_id -> should form chain edge
        assert_eq!(dag.edges.len(), 1);
        assert_eq!(dag.edges[0].source, "a");
        assert_eq!(dag.edges[0].target, "b");
        assert!(matches!(dag.edges[0].edge_type, EdgeType::Chain));
    }

    #[test]
    fn build_dag_chain_three_tasks() {
        let tasks = vec![
            make_node("a", "t1", None),
            make_node("b", "t2", None),
            make_node("c", "t3", None),
        ];
        let dag = build_dag(tasks);
        assert_eq!(dag.nodes.len(), 3);
        // Windows: (a,b) and (b,c) -> 2 chain edges
        assert_eq!(dag.edges.len(), 2);

        let chain_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Chain)).collect();
        assert_eq!(chain_edges.len(), 2);
    }

    // ─── Group (tasks share group_id) ──────────────────────────

    #[test]
    fn build_dag_group_two_members() {
        let tasks = vec![make_node("t1", "add", Some("g1")), make_node("t2", "add", Some("g1"))];
        let dag = build_dag(tasks);
        assert_eq!(dag.nodes.len(), 2);
        // Group of 2: one edge (t1, t2)
        assert_eq!(dag.edges.len(), 1);
        assert!(matches!(dag.edges[0].edge_type, EdgeType::Group));
    }

    #[test]
    fn build_dag_group_three_members() {
        let tasks = vec![
            make_node("t1", "add", Some("g1")),
            make_node("t2", "add", Some("g1")),
            make_node("t3", "add", Some("g1")),
        ];
        let dag = build_dag(tasks);
        assert_eq!(dag.nodes.len(), 3);
        // Group of 3: C(3,2) = 3 edges
        let group_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Group)).collect();
        assert_eq!(group_edges.len(), 3);
    }

    #[test]
    fn build_dag_group_four_members() {
        let tasks = vec![
            make_node("t1", "add", Some("g1")),
            make_node("t2", "add", Some("g1")),
            make_node("t3", "add", Some("g1")),
            make_node("t4", "add", Some("g1")),
        ];
        let dag = build_dag(tasks);
        // C(4,2) = 6 group edges
        let group_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Group)).collect();
        assert_eq!(group_edges.len(), 6);
    }

    // ─── Multiple groups ───────────────────────────────────────

    #[test]
    fn build_dag_two_separate_groups() {
        let tasks = vec![
            make_node("t1", "add", Some("g1")),
            make_node("t2", "add", Some("g1")),
            make_node("t3", "mul", Some("g2")),
            make_node("t4", "mul", Some("g2")),
        ];
        let dag = build_dag(tasks);
        assert_eq!(dag.nodes.len(), 4);
        // Each group of 2 contributes 1 edge = 2 group edges total
        let group_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Group)).collect();
        assert_eq!(group_edges.len(), 2);
        // No chain edges since all tasks are in groups
        let chain_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Chain)).collect();
        assert_eq!(chain_edges.len(), 0);
    }

    // ─── Mixed: chain + group ──────────────────────────────────

    #[test]
    fn build_dag_chain_with_group() {
        let tasks = vec![
            make_node("a", "chain_task", None),
            make_node("b", "chain_task", None),
            make_node("c", "group_task", Some("g1")),
            make_node("d", "group_task", Some("g1")),
        ];
        let dag = build_dag(tasks);
        assert_eq!(dag.nodes.len(), 4);

        let chain_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Chain)).collect();
        let group_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Group)).collect();

        // a->b chain (both no group), c-d group
        assert_eq!(chain_edges.len(), 1);
        assert_eq!(group_edges.len(), 1);
    }

    // ─── root_id ───────────────────────────────────────────────

    #[test]
    fn build_dag_root_is_first_task() {
        let tasks = vec![make_node("z", "last", None), make_node("a", "first", None)];
        let dag = build_dag(tasks);
        // root_id is tasks[0].task_id, which is "z" (the first in the input vec)
        assert_eq!(dag.root_id, "z");
    }

    // ─── Node data preservation ────────────────────────────────

    #[test]
    fn build_dag_preserves_node_data() {
        let node = DagNode {
            task_id: "t1".into(),
            task_name: "complex.task".into(),
            state: "FAILURE".into(),
            runtime: Some(42.5),
            queue: "high-priority".into(),
            worker_id: "celery@worker-5".into(),
            group_id: None,
            parent_id: None,
            chord_id: None,
        };
        let dag = build_dag(vec![node]);
        assert_eq!(dag.nodes[0].task_name, "complex.task");
        assert_eq!(dag.nodes[0].state, "FAILURE");
        assert_eq!(dag.nodes[0].runtime, Some(42.5));
        assert_eq!(dag.nodes[0].queue, "high-priority");
        assert_eq!(dag.nodes[0].worker_id, "celery@worker-5");
    }

    // ─── Parent-based chain ─────────────────────────────────

    #[test]
    fn build_dag_parent_chain() {
        let tasks = vec![
            make_node_with_parent("a", "step1", None),
            make_node_with_parent("b", "step2", Some("a")),
            make_node_with_parent("c", "step3", Some("b")),
        ];
        let dag = build_dag(tasks);
        let chain_edges: Vec<_> =
            dag.edges.iter().filter(|e| matches!(e.edge_type, EdgeType::Chain)).collect();
        assert_eq!(chain_edges.len(), 2);
        assert_eq!(chain_edges[0].source, "a");
        assert_eq!(chain_edges[0].target, "b");
        assert_eq!(chain_edges[1].source, "b");
        assert_eq!(chain_edges[1].target, "c");
    }
}
