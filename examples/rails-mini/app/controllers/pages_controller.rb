class PagesController < ApplicationController
  def about
    redirect_to root_path unless logged_in?
  end
end
