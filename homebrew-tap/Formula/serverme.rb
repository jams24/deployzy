class Serverme < Formula
  desc "Open-source tunnel to expose your local servers to the internet"
  homepage "https://serverme.site"
  version "1.0.7"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_darwin_arm64.tar.gz"
      sha256 "500ee311c30f2392fde5195e4e2ae600ad8226385a006cadfd2ae21372a25a89"
    else
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_darwin_amd64.tar.gz"
      sha256 "bc4a39e5899b0c2456e6397479b899b9b545de595f24cad517e3554b34876f68"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_linux_arm64.tar.gz"
      sha256 "6b83adae5588f388073398499cc738e9736b45fd6434fb208d0b60ae1f6d9f98"
    else
      url "https://github.com/jams24/serverme/releases/download/v#{version}/serverme_linux_amd64.tar.gz"
      sha256 "101eed6b9b7c9547903d23afe4e6b0ac75183c7c7f08260a59430fc54ca34836"
    end
  end

  def install
    bin.install "serverme"
  end

  test do
    assert_match "serverme version", shell_output("#{bin}/serverme version")
  end
end
