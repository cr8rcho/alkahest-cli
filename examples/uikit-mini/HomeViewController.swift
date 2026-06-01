import UIKit

class HomeViewController: UIViewController {
    let startButton = UIButton()
    let nameField = UITextField()

    @objc func openDetails() {
        let detailsVC = DetailsViewController()
        navigationController?.pushViewController(detailsVC, animated: true)
    }

    @objc func openSettings() {
        present(SettingsViewController(), animated: true)
    }
}
