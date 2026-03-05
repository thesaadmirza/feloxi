use crate::middleware::CurrentUser;
use common::AppError;

/// Check if a user has the required permission.
pub fn check_permission(user: &CurrentUser, required: &str) -> Result<(), AppError> {
    if user.has_permission(required) || user.is_admin() {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!("Missing permission: {required}")))
    }
}

/// Check if user has any of the required permissions.
pub fn check_any_permission(user: &CurrentUser, required: &[&str]) -> Result<(), AppError> {
    if user.is_admin() {
        return Ok(());
    }

    for perm in required {
        if user.has_permission(perm) {
            return Ok(());
        }
    }

    Err(AppError::Forbidden(format!("Missing one of permissions: {}", required.join(", "))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_user(roles: Vec<&str>, permissions: Vec<&str>) -> CurrentUser {
        CurrentUser {
            user_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            email: "test@example.com".to_string(),
            roles: roles.into_iter().map(|s| s.to_string()).collect(),
            permissions: permissions.into_iter().map(|s| s.to_string()).collect(),
        }
    }

    // ── check_permission ──

    #[test]
    fn test_check_permission_admin_bypasses_check() {
        // Admin user without the specific permission should still pass
        let user = make_user(vec!["admin"], vec![]);
        assert!(check_permission(&user, "settings_write").is_ok());
        assert!(check_permission(&user, "any_random_permission").is_ok());
    }

    #[test]
    fn test_check_any_permission_admin_bypasses() {
        let user = make_user(vec!["admin"], vec![]);
        assert!(check_any_permission(&user, &["settings_write", "team_manage"]).is_ok());
    }

    #[test]
    fn test_check_any_permission_empty_required_admin_passes() {
        let user = make_user(vec!["admin"], vec![]);
        assert!(check_any_permission(&user, &[]).is_ok());
    }

    // ── SystemRole permission sets (from common) ──

    #[test]
    fn test_system_role_admin_has_all_permissions() {
        use common::types::{Permission, SystemRole};

        let admin_perms = SystemRole::Admin.permissions();
        // Admin should have all 14 permissions
        assert_eq!(admin_perms.len(), 14);
        assert!(admin_perms.contains(&Permission::TasksRead));
        assert!(admin_perms.contains(&Permission::TasksRetry));
        assert!(admin_perms.contains(&Permission::TasksRevoke));
        assert!(admin_perms.contains(&Permission::WorkersRead));
        assert!(admin_perms.contains(&Permission::WorkersShutdown));
        assert!(admin_perms.contains(&Permission::AlertsRead));
        assert!(admin_perms.contains(&Permission::AlertsWrite));
        assert!(admin_perms.contains(&Permission::BeatRead));
        assert!(admin_perms.contains(&Permission::MetricsRead));
        assert!(admin_perms.contains(&Permission::SettingsRead));
        assert!(admin_perms.contains(&Permission::SettingsWrite));
        assert!(admin_perms.contains(&Permission::TeamManage));
        assert!(admin_perms.contains(&Permission::ApiKeysManage));
        assert!(admin_perms.contains(&Permission::BrokersManage));
    }

    #[test]
    fn test_system_role_editor_permissions() {
        use common::types::{Permission, SystemRole};

        let editor_perms = SystemRole::Editor.permissions();
        assert_eq!(editor_perms.len(), 10);
        assert!(editor_perms.contains(&Permission::TasksRead));
        assert!(editor_perms.contains(&Permission::TasksRetry));
        assert!(editor_perms.contains(&Permission::WorkersRead));
        assert!(editor_perms.contains(&Permission::AlertsRead));
        assert!(editor_perms.contains(&Permission::AlertsWrite));
        assert!(editor_perms.contains(&Permission::BeatRead));
        assert!(editor_perms.contains(&Permission::MetricsRead));
        assert!(editor_perms.contains(&Permission::SettingsRead));
        assert!(editor_perms.contains(&Permission::ApiKeysManage));
        assert!(editor_perms.contains(&Permission::BrokersManage));
        // Editor should NOT have these dangerous permissions
        assert!(!editor_perms.contains(&Permission::TasksRevoke));
        assert!(!editor_perms.contains(&Permission::WorkersShutdown));
        assert!(!editor_perms.contains(&Permission::SettingsWrite));
        assert!(!editor_perms.contains(&Permission::TeamManage));
    }

    #[test]
    fn test_system_role_viewer_permissions() {
        use common::types::{Permission, SystemRole};

        let viewer_perms = SystemRole::Viewer.permissions();
        assert_eq!(viewer_perms.len(), 5);
        assert!(viewer_perms.contains(&Permission::TasksRead));
        assert!(viewer_perms.contains(&Permission::WorkersRead));
        assert!(viewer_perms.contains(&Permission::AlertsRead));
        assert!(viewer_perms.contains(&Permission::BeatRead));
        assert!(viewer_perms.contains(&Permission::MetricsRead));
        // Viewer should NOT have any write permissions
        assert!(!viewer_perms.contains(&Permission::TasksRetry));
        assert!(!viewer_perms.contains(&Permission::TasksRevoke));
        assert!(!viewer_perms.contains(&Permission::AlertsWrite));
        assert!(!viewer_perms.contains(&Permission::SettingsWrite));
    }

    #[test]
    fn test_system_role_readonly_minimal_permissions() {
        use common::types::{Permission, SystemRole};

        let readonly_perms = SystemRole::Readonly.permissions();
        assert_eq!(readonly_perms.len(), 2);
        assert!(readonly_perms.contains(&Permission::TasksRead));
        assert!(readonly_perms.contains(&Permission::WorkersRead));
    }

    #[test]
    fn test_system_role_hierarchy() {
        use common::types::SystemRole;

        // Each higher role should have strictly more permissions
        let readonly_count = SystemRole::Readonly.permissions().len();
        let viewer_count = SystemRole::Viewer.permissions().len();
        let editor_count = SystemRole::Editor.permissions().len();
        let admin_count = SystemRole::Admin.permissions().len();

        assert!(
            readonly_count < viewer_count,
            "Viewer ({}) should have more permissions than Readonly ({})",
            viewer_count,
            readonly_count
        );
        assert!(
            viewer_count < editor_count,
            "Editor ({}) should have more permissions than Viewer ({})",
            editor_count,
            viewer_count
        );
        assert!(
            editor_count < admin_count,
            "Admin ({}) should have more permissions than Editor ({})",
            admin_count,
            editor_count
        );
    }

    #[test]
    fn test_system_role_readonly_is_subset_of_all_others() {
        use common::types::SystemRole;

        let readonly_perms = SystemRole::Readonly.permissions();
        let viewer_perms = SystemRole::Viewer.permissions();
        let editor_perms = SystemRole::Editor.permissions();
        let admin_perms = SystemRole::Admin.permissions();

        for perm in &readonly_perms {
            assert!(viewer_perms.contains(perm), "Viewer should include {:?}", perm);
            assert!(editor_perms.contains(perm), "Editor should include {:?}", perm);
            assert!(admin_perms.contains(perm), "Admin should include {:?}", perm);
        }
    }
}
