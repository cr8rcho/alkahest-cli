import UIKit

class SettingsViewController: UITableViewController {
    let darkModeToggle = UISwitch()

    @objc func openHome() {
        let homeVC = HomeViewController()
        show(homeVC, sender: self)
    }
}
