import UIKit

class DetailsViewController: UIViewController {
    let resultsTable = UITableView()

    func loadData() {
        let endpoint = URL(string: "https://api.example.com/items")
        // load with URLSession…
    }

    @objc func goBack() {
        navigationController?.popViewController(animated: true)
    }
}
